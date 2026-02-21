import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Panel } from "../components/Panel";
import { generatePlan, getPlans, getSessionMessages, postChat, type Plan } from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

function shouldSuggestPlan(draft: string): boolean {
  const text = draft.toLowerCase().trim();
  if (!text) {
    return false;
  }
  const multiStepWords = [
    "depois",
    "entao",
    "em seguida",
    "passo",
    "pipeline",
    "capturar",
    "transcod",
    "hls",
    "agendar",
    "schedule",
    "automat",
  ];
  const commands = text.split(/,| e | then | -> /).length;
  if (commands >= 3) {
    return true;
  }
  return multiStepWords.some((token) => text.includes(token));
}

export function ChatPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionKey, setSessionKey] = useState("main");
  const [draft, setDraft] = useState("");
  const [planComposerOpen, setPlanComposerOpen] = useState(false);
  const [planObjective, setPlanObjective] = useState("");
  const [planMaxSteps, setPlanMaxSteps] = useState(8);
  const [planHintDismissed, setPlanHintDismissed] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messages = useQuery({
    queryKey: ["session-messages", sessionKey],
    queryFn: () => getSessionMessages(sessionKey),
  });
  const plans = useQuery({
    queryKey: ["plans", "session", sessionKey],
    queryFn: () => getPlans({ sessionKey, limit: 10 }),
  });

  const send = useMutation({
    mutationFn: async (message: string) => postChat(sessionKey, message),
    onSuccess: async () => {
      setPendingUserMessage(null);
      setSendError(null);
      await queryClient.invalidateQueries({ queryKey: ["session-messages", sessionKey] });
    },
    onError: (error, message) => {
      setSendError(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
      setDraft((current) => (current.trim().length > 0 ? current : message));
      setPendingUserMessage(null);
    },
  });
  const createPlan = useMutation({
    mutationFn: async (params: { openAfterCreate: boolean }) => {
      const objective = planObjective.trim();
      if (!objective) {
        throw new Error("Defina o objetivo do plano antes de gerar.");
      }
      const plan = await generatePlan({
        sessionKey,
        objective,
        maxSteps: planMaxSteps,
      });
      return { plan, openAfterCreate: params.openAfterCreate };
    },
    onSuccess: async ({ plan, openAfterCreate }) => {
      setPlanComposerOpen(false);
      setPlanHintDismissed(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plans", "session", sessionKey] }),
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
      ]);
      if (openAfterCreate) {
        navigate(`/plans?planId=${encodeURIComponent(plan.id)}`);
      }
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) {
      return;
    }
    setDraft("");
    setSendError(null);
    setPendingUserMessage(message);
    void send.mutateAsync(message);
  };

  const planSuggestionVisible = shouldSuggestPlan(draft) && !planHintDismissed;
  const latestPlan: Plan | undefined = (plans.data ?? [])
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.data?.length, pendingUserMessage, send.isPending]);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-4">
      <Panel title="Session" right={<span className="text-xs text-kael-muted">live updates</span>}>
        <label className="text-xs text-kael-muted" htmlFor="sessionKey">Session key</label>
        <input
          id="sessionKey"
          value={sessionKey}
          onChange={(event) => setSessionKey(event.target.value || "main")}
          className="mt-2 w-full rounded border border-kael-border bg-kael-panelSoft px-2 py-1.5 text-sm outline-none focus:border-kael-accent"
        />
      </Panel>
      <div className="min-w-0 lg:col-span-3">
        <Panel title="Conversation">
          {latestPlan && (
            <div className="mb-3 rounded-xl border border-kael-border bg-kael-panelSoft p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wider text-kael-muted">Plano da sessao</p>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(latestPlan.status)}`}>
                  {latestPlan.status}
                </span>
              </div>
              <p className="truncate text-sm font-medium">{latestPlan.title}</p>
              <p className="text-xs text-kael-muted">
                updated: {formatDate(latestPlan.updatedAt)} • steps: {latestPlan.steps.length}
              </p>
              <div className="mt-2 flex gap-2">
                <Link
                  to={`/plans?planId=${encodeURIComponent(latestPlan.id)}`}
                  className="rounded border border-kael-accent/60 bg-kael-accent/20 px-2 py-1 text-xs hover:bg-kael-accent/30"
                >
                  Open in Plans
                </Link>
              </div>
            </div>
          )}
          <div className="kael-scroll mb-3 max-h-[55vh] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden rounded-xl border border-kael-border bg-kael-panelSoft p-3">
            {(messages.data ?? []).map((item) => (
              <div
                key={item.id}
                className={`min-w-0 rounded-lg border p-2 text-sm ${
                  item.role === "user"
                    ? "border-cyan-400/30 bg-cyan-500/10"
                    : item.role === "assistant"
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-amber-400/30 bg-amber-500/10"
                }`}
              >
                <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="truncate uppercase tracking-wider text-kael-muted">{item.role}</span>
                  <span className="shrink-0 text-kael-muted">{formatDate(item.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.content}</p>
              </div>
            ))}
            {pendingUserMessage && (
              <>
                <div className="min-w-0 rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-2 text-sm">
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                    <span className="truncate uppercase tracking-wider text-kael-muted">user</span>
                    <span className="shrink-0 text-kael-muted">sending...</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{pendingUserMessage}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2 text-sm">
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                    <span className="truncate uppercase tracking-wider text-kael-muted">assistant</span>
                    <span className="shrink-0 text-kael-muted">thinking...</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-200/80 animate-pulse" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-200/80 animate-pulse [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-200/80 animate-pulse [animation-delay:240ms]" />
                  </div>
                </div>
              </>
            )}
            {(messages.data ?? []).length === 0 && <p className="text-sm text-kael-muted">No messages yet.</p>}
            <div ref={messagesEndRef} />
          </div>
          {sendError && <p className="mb-3 text-xs text-rose-200">{sendError}</p>}
          {planSuggestionVisible && (
            <div className="mb-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3">
              <p className="text-sm font-medium">Parece uma tarefa multi-etapa.</p>
              <p className="mt-1 text-xs text-kael-muted">
                Criar um plano antes da execucao melhora rastreabilidade e seguranca operacional.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlanComposerOpen(true);
                    setPlanObjective(draft.trim());
                  }}
                  className="rounded border border-kael-accent/60 bg-kael-accent/20 px-2 py-1 text-xs hover:bg-kael-accent/30"
                >
                  Criar Plano (Recomendado)
                </button>
                <button
                  type="button"
                  onClick={() => setPlanHintDismissed(true)}
                  className="rounded border border-kael-border px-2 py-1 text-xs hover:border-kael-accent/50"
                >
                  Seguir sem plano
                </button>
              </div>
            </div>
          )}
          {planComposerOpen && (
            <div className="mb-3 rounded-xl border border-kael-border bg-kael-panelSoft p-3">
              <p className="mb-2 text-sm font-medium">Gerar plano para esta sessao</p>
              <label className="text-xs text-kael-muted">Objetivo</label>
              <textarea
                value={planObjective}
                onChange={(event) => setPlanObjective(event.target.value)}
                className="mt-1 min-h-[90px] w-full rounded border border-kael-border bg-kael-panel px-2 py-2 text-sm outline-none focus:border-kael-accent"
              />
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-kael-muted" htmlFor="planMaxSteps">
                  Max steps
                </label>
                <input
                  id="planMaxSteps"
                  type="number"
                  min={3}
                  max={12}
                  value={planMaxSteps}
                  onChange={(event) => setPlanMaxSteps(Number(event.target.value) || 8)}
                  className="w-20 rounded border border-kael-border bg-kael-panel px-2 py-1 text-xs outline-none focus:border-kael-accent"
                />
              </div>
              {createPlan.error && (
                <p className="mt-2 text-xs text-rose-200">
                  {createPlan.error instanceof Error ? createPlan.error.message : "Falha ao gerar plano."}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={createPlan.isPending}
                  onClick={() => {
                    void createPlan.mutateAsync({ openAfterCreate: false });
                  }}
                  className="rounded border border-kael-accent/60 bg-kael-accent/20 px-2 py-1 text-xs hover:bg-kael-accent/30 disabled:opacity-60"
                >
                  Gerar plano
                </button>
                <button
                  type="button"
                  disabled={createPlan.isPending}
                  onClick={() => {
                    void createPlan.mutateAsync({ openAfterCreate: true });
                  }}
                  className="rounded border border-kael-border px-2 py-1 text-xs hover:border-kael-accent/50 disabled:opacity-60"
                >
                  Gerar e abrir Plans
                </button>
                <button
                  type="button"
                  onClick={() => setPlanComposerOpen(false)}
                  className="rounded border border-kael-border px-2 py-1 text-xs hover:border-kael-accent/50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Talk to Kael..."
              className="min-w-0 flex-1 rounded border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm outline-none focus:border-kael-accent"
            />
            <button
              type="submit"
              disabled={send.isPending}
              className="rounded border border-kael-accent/60 bg-kael-accent/20 px-3 py-2 text-sm font-medium hover:bg-kael-accent/30 disabled:opacity-60"
            >
              {send.isPending ? "Sending..." : "Send"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlanComposerOpen(true);
                setPlanObjective(draft.trim());
              }}
              className="rounded border border-kael-border px-3 py-2 text-sm hover:border-kael-accent/50"
            >
              Plan
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
