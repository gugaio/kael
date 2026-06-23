import type { PlanExecutionInputs, PlanStep } from "./service.js";

export type ActionHandlerResult =
  | {
      ok: true;
      execution: PlanStep["execution"];
    }
  | {
      ok: false;
      message: string;
    };

export type ActionHandler = {
  requiredInputs: string[];
  execute: (params: {
    sessionKey: string;
    inputs: PlanExecutionInputs;
  }) => Promise<ActionHandlerResult>;
};

export class ActionRegistry {
  private handlers = new Map<string, ActionHandler>();

  register(kind: string, handler: ActionHandler): void {
    this.handlers.set(kind, handler);
  }

  get(kind: string): ActionHandler | undefined {
    return this.handlers.get(kind);
  }

  has(kind: string): boolean {
    return this.handlers.has(kind);
  }
}
