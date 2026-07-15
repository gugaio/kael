import type { AgentContext } from "../../agents/context.js";
import { kaelLogger } from "../../infra/logger.js";
import { createPlannerReconcileContext } from "../../planner/execution-context.js";

export type ReconcilePlansNowParams = {
  planId?: string;
  limit?: number;
};

export class ApiPlanReconciler {
  private readonly reconcileContext;

  constructor(private readonly agent: AgentContext) {
    this.reconcileContext = createPlannerReconcileContext({
      jobs: agent.video.jobs,
      shell: agent.runtimes.shell,
    });
  }

  reconcileNow = async (params?: ReconcilePlansNowParams): Promise<void> => {
    try {
      await this.agent.services.planner.reconcile({
        planId: params?.planId,
        limit: params?.limit,
        runtime: this.reconcileContext,
      });
    } catch (error) {
      kaelLogger.warn("planner.reconcile.on_demand_failed", {
        planId: params?.planId ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
