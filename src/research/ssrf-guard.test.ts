import { describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl, fetchWithSsrFGuard } from "./ssrf-guard.js";

describe("ssrf guard", () => {
  it("blocks localhost and private ip literals", async () => {
    await expect(assertPublicHttpUrl({ url: "http://localhost/test" })).rejects.toThrow(/blocked hostname/i);
    await expect(assertPublicHttpUrl({ url: "http://127.0.0.1/test" })).rejects.toThrow(/blocked private ip/i);
    await expect(assertPublicHttpUrl({ url: "http://10.0.0.1/test" })).rejects.toThrow(/blocked private ip/i);
  });

  it("blocks when dns resolves to private address", async () => {
    const lookup = vi.fn(async () => [{ address: "192.168.1.10", family: 4 }]);
    await expect(
      assertPublicHttpUrl({
        url: "https://example.com",
        lookup,
      }),
    ).rejects.toThrow(/blocked private resolved ip/i);
  });

  it("blocks redirect to private host", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: {
            location: "http://127.0.0.1/internal",
          },
        }),
      );
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(
      fetchWithSsrFGuard({
        url: "https://example.com",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookup,
        maxRedirects: 3,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/blocked private ip/i);
  });
});

