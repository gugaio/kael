import { BROWSER_ACTIONS, type BrowserCommandAction, type BrowserCommandResult } from "./service.js";

export function isBrowserInteractionAction(action: string): action is BrowserCommandAction {
  return (
    action === BROWSER_ACTIONS.click ||
    action === BROWSER_ACTIONS.type ||
    action === BROWSER_ACTIONS.press ||
    action === BROWSER_ACTIONS.waitFor
  );
}

export function formatBrowserToolText(result: BrowserCommandResult): string {
  return [
    `ok=${result.ok}`,
    `action=${result.action}`,
    `status=${result.status}`,
    `message=${result.message}`,
    result.targetId ? `targetId=${result.targetId}` : "",
    result.url ? `url=${result.url}` : "",
    result.title ? `title=${result.title}` : "",
    result.screenshotPath ? `screenshotPath=${result.screenshotPath}` : "",
    result.textPreview ? `textPreview=${result.textPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBrowserReplyText(result: BrowserCommandResult): string {
  return [
    `browser action=${result.action} status=${result.status}`,
    `ok=${result.ok ? "true" : "false"}`,
    `message=${result.message}`,
    result.targetId ? `targetId=${result.targetId}` : "",
    result.url ? `url=${result.url}` : "",
    result.title ? `title=${result.title}` : "",
    result.screenshotPath ? `screenshot=${result.screenshotPath}` : "",
    result.textPreview ? `preview=${result.textPreview.slice(0, 240)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
