import type {
  BrowserCommandAction,
  BrowserCommandInput,
  BrowserCommandResult,
  BrowserRuntime,
  BrowserRuntimeTelemetry,
} from "./service.js";

export const BROWSER_ACTIONS = {
  start: "start",
  open: "open",
  navigate: "navigate",
  snapshotText: "snapshot_text",
  screenshot: "screenshot",
  click: "click",
  type: "type",
  press: "press",
  waitFor: "wait_for",
  close: "close",
} as const satisfies Record<string, BrowserCommandAction>;

export const BROWSER_ACTION_VALUES = Object.values(BROWSER_ACTIONS) as BrowserCommandAction[];

type BrowserActionParams = Omit<BrowserCommandInput, "action">;

export class BrowserInteractiveCapability {
  readonly name = "browser";
  readonly actions = BROWSER_ACTION_VALUES;

  constructor(private readonly runtime: BrowserRuntime) {}

  executeAction(action: BrowserCommandAction, params: BrowserActionParams): Promise<BrowserCommandResult> {
    return this.runtime.command({
      ...params,
      action,
    });
  }

  getRuntimeTelemetrySnapshot(): BrowserRuntimeTelemetry {
    return this.runtime.getRuntimeTelemetrySnapshot();
  }
}
