import type { AgentTool } from "@mariozechner/pi-agent-core";
import { formatJobDetailsText, formatJobLogText, formatJobsListText } from "../../jobs/tooling.js";
import type { EngineToolingInterface } from "../../agents/types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createJobsPiTools(params: {
  tooling: EngineToolingInterface["jobs"];
  textResult: (text: string) => TextBlock[];
  reserveToolCall: (tool: string) => { blocked: { content: TextBlock[]; details: unknown } } | null;
  logToolStart: (tool: string, rawParams: unknown) => string;
  logToolEnd: (
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
  ) => void;
}): AgentTool[] {
  const jobsListTool: AgentTool = {
    name: "jobs_list",
    label: "Jobs List",
    description:
      "Lista jobs existentes com filtros opcionais (sessionKey, status). Use para perguntas sobre jobs recentes/anteriores.",
    parameters: {
      type: "object",
      properties: {
        sessionKey: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("jobs_list");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        sessionKey?: string;
        status?: string;
        limit?: number;
      };
      const intent = params.logToolStart("jobs_list", args);
      const jobs = params.tooling.listJobs({
        sessionKey: args.sessionKey,
        status: args.status,
        limit: args.limit,
      });
      const text = formatJobsListText(jobs);
      const details = { jobs };
      params.logToolEnd(
        "jobs_list",
        intent,
        { status: "completed", resultCount: jobs.length },
        startedAtMs,
      );
      return {
        content: params.textResult(text),
        details,
      };
    },
  };

  const jobsGetTool: AgentTool = {
    name: "jobs_get",
    label: "Jobs Get",
    description: "Busca detalhes completos de um job por id.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
      },
      required: ["jobId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("jobs_get");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { jobId: string };
      const intent = params.logToolStart("jobs_get", args);
      const job = params.tooling.getJob({ jobId: args.jobId });
      if (!job) {
        const details = { status: "not_found", jobId: args.jobId };
        params.logToolEnd("jobs_get", intent, details, startedAtMs);
        return {
          content: params.textResult(`found=false\njobId=${args.jobId}`),
          details,
        };
      }
      const text = formatJobDetailsText(job);
      const details = { status: "completed", job };
      params.logToolEnd("jobs_get", intent, details, startedAtMs);
      return {
        content: params.textResult(text),
        details,
      };
    },
  };

  const jobsLogTailTool: AgentTool = {
    name: "jobs_log_tail",
    label: "Jobs Log Tail",
    description: "Le cauda do log de um job por id.",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        tailChars: { type: "number" },
      },
      required: ["jobId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const blocked = params.reserveToolCall("jobs_log_tail");
      if (blocked) {
        return blocked.blocked;
      }
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as { jobId: string; tailChars?: number };
      const intent = params.logToolStart("jobs_log_tail", args);
      const result = await params.tooling.getJobLog({
        jobId: args.jobId,
        tailChars: args.tailChars,
      });
      if (!result.found) {
        const details = { status: "not_found", jobId: args.jobId };
        params.logToolEnd("jobs_log_tail", intent, details, startedAtMs);
        return {
          content: params.textResult(`found=false\njobId=${args.jobId}`),
          details,
        };
      }
      const text = formatJobLogText({ jobId: args.jobId, log: result.log ?? "" });
      const details = { status: "completed", jobId: args.jobId, chars: result.log?.length ?? 0 };
      params.logToolEnd("jobs_log_tail", intent, details, startedAtMs);
      return {
        content: params.textResult(text),
        details,
      };
    },
  };

  return [jobsListTool, jobsGetTool, jobsLogTailTool];
}
