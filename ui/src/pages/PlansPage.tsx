import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import { cancelPlan, executeNextPlanStep, getPlan, getPlans, reconcilePlans } from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

export function PlansPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [sessionFilter, setSessionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [executeSessionKey, setExecuteSessionKey] = useState("");
  const [executeInputsText, setExecuteInputsText] = useState(
    '{\n  "inputPath": "/tmp/input.mp4",\n  "outputPath": "/tmp/output.mp4"\n}',
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ["plans", sessionFilter, statusFilter],
    queryFn: () =>
      getPlans({
        sessionKey: sessionFilter.trim() || undefined,
        status:
          statusFilter === "active" ||
          statusFilter === "completed" ||
          statusFilter === "blocked" ||
          statusFilter === "failed" ||
          statusFilter === "canceled"
            ? statusFilter
            : undefined,
        limit: 100,
      }),
    refetchInterval: 3000,
  });

  const selectedPlan = useQuery({
    queryKey: ["plan", selectedPlanId],
    queryFn: () => getPlan(selectedPlanId),
    enabled: Boolean(selectedPlanId),
    refetchInterval: 2000,
  });

  useEffect(() => {
    const planIdFromQuery = searchParams.get("planId")?.trim();
    const list = plans.data ?? [];
    if (list.length === 0) {
      setSelectedPlanId("");
      return;
    }
    if (planIdFromQuery && list.some((item) => item.id === planIdFromQuery)) {
      setSelectedPlanId(planIdFromQuery);
      return;
    }
    if (!selectedPlanId || !list.some((item) => item.id === selectedPlanId)) {
      setSelectedPlanId(list[0].id);
    }
  }, [plans.data, searchParams, selectedPlanId]);

  const executeNext = useMutation({
    mutationFn: async () => {
      if (!selectedPlanId) {
        throw new Error("Selecione um plano.");
      }
      let parsedInputs: Record<string, unknown> | undefined;
      const raw = executeInputsText.trim();
      if (raw.length > 0) {
        try {
          const value = JSON.parse(raw) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("inputs JSON deve ser um objeto");
          }
          parsedInputs = value as Record<string, unknown>;
        } catch (error) {
          throw new Error(error instanceof Error ? `Inputs invalidos: ${error.message}` : "Inputs invalidos");
        }
      }
      return executeNextPlanStep({
        planId: selectedPlanId,
        sessionKey: executeSessionKey.trim() || undefined,
        inputs: parsedInputs as never,
      });
    },
    onSuccess: async (result) => {
      setActionError(null);
      if (result.ok) {
        const execution = result.execution ? ` (${result.execution.kind}:${result.execution.refId})` : "";
        setActionMessage(
          `execute-next ok action=${result.action ?? "unknown"} stepIndex=${String(result.stepIndex ?? "-")}${execution}`,
        );
      } else {
        setActionMessage(
          `execute-next bloqueado reason=${result.reason ?? "unknown"} message=${result.message ?? "-"}`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
        queryClient.invalidateQueries({ queryKey: ["plan", selectedPlanId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Falha ao executar step.");
    },
  });

  const reconcile = useMutation({
    mutationFn: async () =>
      reconcilePlans({
        planId: selectedPlanId || undefined,
        limit: 200,
      }),
    onSuccess: async (result) => {
      setActionError(null);
      setActionMessage(
        `reconcile scanned=${result.scannedPlans} updatedPlans=${result.updatedPlans} updatedSteps=${result.updatedSteps}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
        queryClient.invalidateQueries({ queryKey: ["plan", selectedPlanId] }),
      ]);
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Falha no reconcile.");
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!selectedPlanId) {
        throw new Error("Selecione um plano.");
      }
      return cancelPlan(selectedPlanId, "cancelado via UI");
    },
    onSuccess: async () => {
      setActionError(null);
      setActionMessage("plan cancelado com sucesso.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
        queryClient.invalidateQueries({ queryKey: ["plan", selectedPlanId] }),
      ]);
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "Falha ao cancelar plano.");
    },
  });

  const selected = selectedPlan.data;
  const activeStep = useMemo(
    () => selected?.steps.find((step) => step.status === "in_progress" || step.status === "pending"),
    [selected],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Plans">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <input
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              placeholder="Filter by sessionKey"
              className="rounded border border-kael-border bg-kael-panelSoft px-2 py-1.5 text-sm outline-none focus:border-kael-accent"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded border border-kael-border bg-kael-panelSoft px-2 py-1.5 text-sm outline-none focus:border-kael-accent"
            >
              <option value="">all status</option>
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="blocked">blocked</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
          <div className="kael-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {(plans.data ?? []).map((plan) => {
              const isSelected = plan.id === selectedPlanId;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`w-full rounded-lg border p-2 text-left text-sm ${
                    isSelected
                      ? "border-kael-accent bg-kael-accent/10"
                      : "border-kael-border bg-kael-panelSoft hover:border-kael-accent/40"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{plan.title}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(plan.status)}`}>
                      {plan.status}
                    </span>
                  </div>
                  <p className="truncate text-xs text-kael-muted">{plan.id}</p>
                  <p className="text-xs text-kael-muted">
                    session={plan.sessionKey} • steps={plan.steps.length}
                  </p>
                </button>
              );
            })}
            {(plans.data ?? []).length === 0 && (
              <p className="text-sm text-kael-muted">No plans found for the current filters.</p>
            )}
          </div>
        </div>
      </Panel>

      <div className="lg:col-span-2">
        <Panel
          title={selected ? `Plan Detail • ${selected.id.slice(0, 8)}` : "Plan Detail"}
          right={<span className="text-xs text-kael-muted">polling 2s</span>}
        >
          {!selected && <p className="text-sm text-kael-muted">Select a plan to inspect execution.</p>}
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(selected.status)}`}>
                    {selected.status}
                  </span>
                  <span className="text-xs text-kael-muted">session={selected.sessionKey}</span>
                </div>
                <p className="font-medium">{selected.title}</p>
                <p className="text-xs text-kael-muted">
                  created={formatDate(selected.createdAt)} • updated={formatDate(selected.updatedAt)}
                </p>
                {activeStep && (
                  <p className="mt-2 text-xs text-kael-muted">
                    next/active step: <span className="text-kael-text">{activeStep.title}</span>
                  </p>
                )}
              </div>

              <div className="grid gap-2 rounded-lg border border-kael-border bg-kael-panelSoft p-3 md:grid-cols-2">
                <input
                  value={executeSessionKey}
                  onChange={(event) => setExecuteSessionKey(event.target.value)}
                  placeholder="sessionKey override (optional)"
                  className="rounded border border-kael-border bg-kael-panel px-2 py-1.5 text-xs outline-none focus:border-kael-accent"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void executeNext.mutateAsync();
                    }}
                    disabled={!selectedPlanId || executeNext.isPending}
                    className="rounded border border-kael-accent/60 bg-kael-accent/20 px-3 py-1.5 text-xs font-medium hover:bg-kael-accent/30 disabled:opacity-60"
                  >
                    Execute Next
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void reconcile.mutateAsync();
                    }}
                    disabled={reconcile.isPending}
                    className="rounded border border-kael-border px-3 py-1.5 text-xs hover:border-kael-accent/50"
                  >
                    Reconcile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void cancel.mutateAsync();
                    }}
                    disabled={!selected || cancel.isPending}
                    className="rounded border border-kael-danger/50 px-3 py-1.5 text-xs text-orange-200 hover:bg-kael-danger/20 disabled:opacity-60"
                  >
                    Cancel Plan
                  </button>
                </div>
                <textarea
                  value={executeInputsText}
                  onChange={(event) => setExecuteInputsText(event.target.value)}
                  className="min-h-[120px] rounded border border-kael-border bg-kael-panel px-2 py-2 font-mono text-xs outline-none focus:border-kael-accent md:col-span-2"
                />
                {actionMessage && <p className="text-xs text-emerald-200 md:col-span-2">{actionMessage}</p>}
                {actionError && <p className="text-xs text-rose-200 md:col-span-2">{actionError}</p>}
              </div>

              <div className="space-y-2">
                {selected.steps.map((step, index) => (
                  <div key={step.id} className="rounded-lg border border-kael-border bg-kael-panelSoft p-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {index + 1}. {step.title}
                      </p>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(step.status)}`}>
                        {step.status}
                      </span>
                    </div>
                    <p className="text-xs text-kael-muted">updated={formatDate(step.updatedAt)}</p>
                    {step.execution && (
                      <p className="mt-1 text-xs text-kael-muted">
                        execution={step.execution.kind}:{step.execution.refId} status={step.execution.status}
                      </p>
                    )}
                    {step.notes && <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">{step.notes}</pre>}
                    {(step.checkpoints ?? []).length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs uppercase tracking-wider text-kael-muted">checkpoints</p>
                        {(step.checkpoints ?? []).slice(-6).map((cp, cpIndex) => (
                          <p key={`${step.id}-${cp.at}-${cpIndex}`} className="text-xs text-kael-muted">
                            {formatDate(cp.at)} • {cp.status}
                            {cp.notes ? ` • ${cp.notes}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {selected.steps.length === 0 && <p className="text-sm text-kael-muted">Plan has no steps.</p>}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
