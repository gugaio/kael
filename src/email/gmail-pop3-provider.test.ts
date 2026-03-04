import { describe, expect, it } from "vitest";
import { parseRetrResponse } from "./gmail-pop3-provider.js";

describe("GmailPop3Provider MIME parsing", () => {
  it("extracts text body and image attachment from multipart email", () => {
    const parsed = parseRetrResponse([
      "From: Alice <alice@example.com>",
      "Subject: Teste Foto",
      "Date: Tue, 03 Mar 2026 10:00:00 +0000",
      "Content-Type: multipart/mixed; boundary=\"mix-123\"",
      "",
      "--mix-123",
      "Content-Type: text/plain; charset=\"utf-8\"",
      "",
      "Ola Kael, veja anexo.",
      "--mix-123",
      "Content-Type: image/jpeg; name=\"surf.jpg\"",
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment; filename=\"surf.jpg\"",
      "",
      "/9j/4AAQSkZJRgABAQAAAQABAAD/",
      "--mix-123--",
    ]);

    expect(parsed.from).toContain("alice@example.com");
    expect(parsed.subject).toBe("Teste Foto");
    expect(parsed.body).toContain("Ola Kael, veja anexo.");
    expect(parsed.attachments.length).toBe(1);
    expect(parsed.attachments[0]).toMatchObject({
      kind: "image",
      fileName: "surf.jpg",
      mimeType: "image/jpeg",
    });
    expect(parsed.attachments[0]?.dataBase64).toContain("/9j/4AAQSkZJRgABAQAAAQABAAD/");
  });
});
