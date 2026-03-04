import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Locator, Page } from "playwright";

export type BrowserCommandAction =
  | "start"
  | "open"
  | "navigate"
  | "snapshot_text"
  | "screenshot"
  | "click"
  | "type"
  | "press"
  | "wait_for"
  | "close";

export type BrowserCommandInput = {
  sessionKey: string;
  action: BrowserCommandAction;
  targetId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
};

export type BrowserCommandResult = {
  ok: boolean;
  action: BrowserCommandAction;
  status:
    | "disabled"
    | "started"
    | "navigated"
    | "snapshotted"
    | "screenshot_saved"
    | "closed"
    | "failed";
  message: string;
  targetId?: string;
  url?: string;
  title?: string;
  textPreview?: string;
  screenshotPath?: string;
};

export type BrowserRuntimeTelemetry = {
  enabled: boolean;
  commands: number;
  failures: number;
  sessionsStarted: number;
  sessionsClosed: number;
  activeSessions: number;
};

export interface BrowserRuntime {
  command(input: BrowserCommandInput): Promise<BrowserCommandResult>;
  getRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry;
}

export type BrowserToolConfig = {
  enabled: boolean;
  headless: boolean;
  defaultTimeoutMs: number;
  actionTimeoutMs: number;
  maxScreenshotsPerTurn: number;
  artifactDir: string;
};

type BrowserSession = {
  targetId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  url?: string;
  title?: string;
  screenshotCount: number;
  startedAt: number;
  updatedAt: number;
};

type SelectorParse =
  | { kind: "text"; value: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "label"; value: string }
  | { kind: "css"; value: string };

export class BrowserToolService implements BrowserRuntime {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly telemetry: BrowserRuntimeTelemetry;

  constructor(private readonly cfg: BrowserToolConfig) {
    this.telemetry = {
      enabled: cfg.enabled,
      commands: 0,
      failures: 0,
      sessionsStarted: 0,
      sessionsClosed: 0,
      activeSessions: 0,
    };
  }

  getRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry {
    return { ...this.telemetry };
  }

  async command(input: BrowserCommandInput): Promise<BrowserCommandResult> {
    this.telemetry.commands += 1;
    if (!this.cfg.enabled) {
      this.telemetry.failures += 1;
      return {
        ok: false,
        action: input.action,
        status: "disabled",
        message: "browser runtime desabilitado (KAEL_BROWSER_ENABLED=false)",
      };
    }
    try {
      if (input.action === "close") {
        return this.closeSession(input.sessionKey);
      }

      if (input.action === "start") {
        const session = await this.ensureSession(input.sessionKey);
        return {
          ok: true,
          action: input.action,
          status: "started",
          message: "browser iniciado",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      if (input.action === "open" || input.action === "navigate") {
        const url = this.validateUrl(input.url);
        const session = await this.ensureSession(input.sessionKey);
        await session.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.resolveTimeoutMs(input.timeoutMs),
        });
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "navigated",
          message: "navegacao concluida",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      if (input.action === "snapshot_text") {
        const session = await this.ensureSession(input.sessionKey);
        const snapshot = await this.snapshotText(session.page);
        session.url = session.page.url();
        session.title = snapshot.title;
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "snapshotted",
          message: "snapshot coletado",
          targetId: session.targetId,
          url: session.url,
          title: snapshot.title,
          textPreview: snapshot.preview,
        };
      }

      if (input.action === "screenshot") {
        const session = await this.ensureSession(input.sessionKey);
        if (session.screenshotCount >= this.cfg.maxScreenshotsPerTurn) {
          return {
            ok: false,
            action: input.action,
            status: "failed",
            message: `limite de screenshots atingido para esta sessao (${this.cfg.maxScreenshotsPerTurn})`,
            targetId: session.targetId,
            url: session.url,
            title: session.title,
          };
        }
        await fs.mkdir(this.cfg.artifactDir, { recursive: true });
        const safeSession = sanitizeForPath(input.sessionKey);
        const fileName = `${safeSession}-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
        const absolutePath = path.join(this.cfg.artifactDir, fileName);
        await session.page.screenshot({
          path: absolutePath,
          fullPage: true,
          timeout: this.resolveTimeoutMs(input.timeoutMs),
        });
        session.screenshotCount += 1;
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "screenshot_saved",
          message: "screenshot salva",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
          screenshotPath: absolutePath,
        };
      }

      if (input.action === "click") {
        const session = await this.ensureSession(input.sessionKey);
        const locator = this.resolveLocator(session.page, input.selector);
        await locator.click({
          timeout: this.resolveTimeoutMs(input.timeoutMs),
        });
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "navigated",
          message: "click executado",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      if (input.action === "type") {
        const text = String(input.text ?? "");
        if (!text.length) {
          throw new Error("texto obrigatorio para acao type");
        }
        const session = await this.ensureSession(input.sessionKey);
        const locator = this.resolveLocator(session.page, input.selector);
        await locator.fill(text, {
          timeout: this.resolveTimeoutMs(input.timeoutMs),
        });
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "navigated",
          message: "type executado",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      if (input.action === "wait_for") {
        const session = await this.ensureSession(input.sessionKey);
        const locator = this.resolveLocator(session.page, input.selector);
        await locator.waitFor({
          state: "visible",
          timeout: this.resolveTimeoutMs(input.timeoutMs),
        });
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "navigated",
          message: "wait_for concluido",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      if (input.action === "press") {
        const key = String(input.key ?? "").trim();
        if (!key.length) {
          throw new Error("tecla obrigatoria para acao press");
        }
        const session = await this.ensureSession(input.sessionKey);
        if (input.selector?.trim()) {
          const locator = this.resolveLocator(session.page, input.selector);
          await locator.click({
            timeout: this.resolveTimeoutMs(input.timeoutMs),
          });
        }
        await session.page.keyboard.press(key);
        session.url = session.page.url();
        session.title = await session.page.title();
        session.updatedAt = Date.now();
        return {
          ok: true,
          action: input.action,
          status: "navigated",
          message: "press executado",
          targetId: session.targetId,
          url: session.url,
          title: session.title,
        };
      }

      this.telemetry.failures += 1;
      return {
        ok: false,
        action: input.action,
        status: "failed",
        message: `acao ainda nao suportada na fase read-only: ${input.action}`,
      };
    } catch (error) {
      this.telemetry.failures += 1;
      return {
        ok: false,
        action: input.action,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveTimeoutMs(override?: number): number {
    const raw = Number(override);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.floor(raw), this.cfg.defaultTimeoutMs);
    }
    return this.cfg.actionTimeoutMs;
  }

  private async ensureSession(sessionKey: string): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }
    const browser = await chromium.launch({
      headless: this.cfg.headless,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const created: BrowserSession = {
      targetId: `browser-${randomUUID().slice(0, 8)}`,
      browser,
      context,
      page,
      screenshotCount: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionKey, created);
    this.telemetry.sessionsStarted += 1;
    this.telemetry.activeSessions = this.sessions.size;
    return created;
  }

  private async closeSession(sessionKey: string): Promise<BrowserCommandResult> {
    const existing = this.sessions.get(sessionKey);
    if (!existing) {
      return {
        ok: true,
        action: "close",
        status: "closed",
        message: "nenhuma sessao ativa para fechar",
      };
    }
    try {
      await existing.context.close();
      await existing.browser.close();
    } finally {
      this.sessions.delete(sessionKey);
      this.telemetry.sessionsClosed += 1;
      this.telemetry.activeSessions = this.sessions.size;
    }
    return {
      ok: true,
      action: "close",
      status: "closed",
      message: "sessao de browser encerrada",
      targetId: existing.targetId,
    };
  }

  private validateUrl(raw: string | undefined): string {
    const value = String(raw ?? "").trim();
    if (!value) {
      throw new Error("url obrigatoria para acao de navegacao");
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`url invalida: ${value}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`protocolo nao suportado: ${parsed.protocol}`);
    }
    return parsed.toString();
  }

  private resolveLocator(page: Page, selectorRaw: string | undefined): Locator {
    const selector = String(selectorRaw ?? "").trim();
    if (!selector.length) {
      throw new Error("selector obrigatorio para esta acao");
    }
    const parsed = parseSelector(selector);
    if (parsed.kind === "text") {
      return page.getByText(parsed.value);
    }
    if (parsed.kind === "role") {
      return page.getByRole(parsed.role as never, parsed.name ? { name: parsed.name } : undefined);
    }
    if (parsed.kind === "label") {
      return page.getByLabel(parsed.value);
    }
    return page.locator(parsed.value);
  }

  private async snapshotText(page: Page): Promise<{ title: string; preview: string }> {
    const title = await page.title();
    const bodyText = await page.evaluate(() => {
      const root = document.body ?? document.documentElement;
      const text = root?.innerText ?? "";
      return text.replace(/\s+/g, " ").trim();
    });
    const preview = bodyText.slice(0, 1800);
    return {
      title,
      preview,
    };
  }
}

function sanitizeForPath(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  return normalized.length > 0 ? normalized.slice(0, 42) : "session";
}

function parseSelector(raw: string): SelectorParse {
  if (raw.startsWith("text=")) {
    return { kind: "text", value: raw.slice("text=".length).trim() };
  }
  if (raw.startsWith("label=")) {
    return { kind: "label", value: raw.slice("label=".length).trim() };
  }
  if (raw.startsWith("role=")) {
    const value = raw.slice("role=".length).trim();
    const [role, name] = value.split("|");
    if (!role?.trim()) {
      throw new Error("seletor role invalido: use role=<role>|<name-opcional>");
    }
    return {
      kind: "role",
      role: role.trim(),
      name: name?.trim() || undefined,
    };
  }
  return { kind: "css", value: raw };
}
