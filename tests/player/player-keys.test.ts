import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

const PLAYER_URL = process.env.PLAYER_URL ?? "http://localhost:8080/#desktop";
const SNAPSHOT_DIR = path.join(os.homedir(), ".kael", "data", "snapshot");
const PLAY_BTN = 'button[aria-label="Pausar"], button[aria-label="Reproduzir"]';

describe("Player TVS-Lite - navegacao por keys", () => {
  it.runIf(process.env.PLAYER_E2E === "1")(
    "simula navegacao por remote keys",
    async () => {
      await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      const logs: string[] = [];
      page.on("console", (msg) => logs.push(msg.text()));

      await page.goto(PLAYER_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });

      const domKeys: string[] = [];
      await page.evaluate(() => {
        document.addEventListener("keydown", (e) => {
          console.log("DOM_KEYDOWN:" + e.key);
        });
      });

      await page.waitForTimeout(4_000);
      await page.screenshot({ path: path.join(SNAPSHOT_DIR, "initial.png") });

      // espera o botao de play existir no DOM (opacity:0 = controles ocultos)
      await page.waitForSelector(PLAY_BTN, { state: "attached", timeout: 10_000 });

      const getButtonLabel = () => page.locator(PLAY_BTN).getAttribute("aria-label");

      // mostra os controles
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: path.join(SNAPSHOT_DIR, "controls-visible.png") });

      let label = await getButtonLabel();
      console.log("Estado inicial:", label);

      // Enter -> pausa -> "Reproduzir"
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_000);
      label = await getButtonLabel();
      console.log("Apos Enter (pause):", label);
      expect(label).toBe("Reproduzir");
      await page.screenshot({ path: path.join(SNAPSHOT_DIR, "paused.png") });

      // Enter -> resume -> "Pausar"
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_000);
      label = await getButtonLabel();
      console.log("Apos Enter (resume):", label);
      expect(label).toBe("Pausar");
      await page.screenshot({ path: path.join(SNAPSHOT_DIR, "playing.png") });

      const domKeyLogs = logs.filter((l) => l.startsWith("DOM_KEYDOWN:"));
      expect(domKeyLogs.length).toBeGreaterThan(0);

      await browser.close();
    },
    30_000,
  );
});
