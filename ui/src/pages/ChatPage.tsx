import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Panel } from "../components/Panel";
import { generatePlan, getSessionMessages, postChat } from "../lib/api";
import { formatDate } from "../lib/format";

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.data?.length, pendingUserMessage, send.isPending]);

  return (
    <div className="grid min-w-0 gap-4 lg:min-h-full lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel title="Session" right={<span className="text-xs text-kael-muted">live updates</span>}>
        <label className="text-xs text-kael-muted" htmlFor="sessionKey">Session key</label>
        <input
          id="sessionKey"
          value={sessionKey}
          onChange={(event) => setSessionKey(event.target.value || "main")}
          className="mt-2 w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm outline-none focus:border-kael-accent"
        />
      </Panel>
      <div className="min-w-0">
        <Panel
          title="Conversation"
          right={(
            <Link
              to="/chat/daily"
              className="rounded-xl border border-kael-border px-3 py-1.5 text-xs text-kael-muted hover:border-kael-accent/50 hover:text-kael-text"
            >
              Daily Chat UI
            </Link>
          )}
        >
          <div className="kael-scroll mb-3 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden rounded-[24px] border border-slate-300 bg-slate-100 p-4 lg:max-h-[calc(100vh-290px)]">
            {(messages.data ?? []).map((item) => (
              <div
                key={item.id}
                className={`w-full min-w-0 rounded-2xl border px-4 py-3 text-base shadow-sm font-reading ${
                  item.role === "user"
                    ? "border-sky-300 bg-sky-100/90 text-slate-900"
                    : item.role === "assistant"
                      ? "border-emerald-300 bg-white text-slate-900"
                      : "border-amber-300 bg-amber-100/80 text-slate-900"
                }`}
              >
                <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="truncate uppercase tracking-wider text-slate-600">{item.role}</span>
                  <span className="shrink-0 text-slate-500">{formatDate(item.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[17px] leading-8 tracking-[0.01em] text-slate-900 [overflow-wrap:anywhere]">
                  {item.content}
                </p>
              </div>
            ))}
            {pendingUserMessage && (
              <>
                <div className="w-full min-w-0 rounded-2xl border border-sky-300 bg-sky-100/90 px-4 py-3 text-base text-slate-900 shadow-sm font-reading">
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                    <span className="truncate uppercase tracking-wider text-slate-600">user</span>
                    <span className="shrink-0 text-slate-500">sending...</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[17px] leading-8 tracking-[0.01em] [overflow-wrap:anywhere]">{pendingUserMessage}</p>
                </div>
                <div className="w-full min-w-0 rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm font-reading">
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-xs">
                    <span className="truncate uppercase tracking-wider text-slate-600">assistant</span>
                    <span className="shrink-0 text-slate-500">thinking...</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 animate-pulse" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 animate-pulse [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 animate-pulse [animation-delay:240ms]" />
                  </div>
                </div>
              </>
            )}
            {(messages.data ?? []).length === 0 && <p className="text-sm text-kael-muted">No messages yet.</p>}
            <div ref={messagesEndRef} />
          </div>
          {sendError && <p className="mb-3 text-xs text-rose-700">{sendError}</p>}
          {planSuggestionVisible && (
            <div className="mb-3 rounded-2xl border border-sky-300 bg-sky-100/80 p-3">
              <p className="text-sm font-medium text-slate-900">Parece uma tarefa multi-etapa.</p>
              <p className="mt-1 text-xs text-slate-600">
                Criar um plano antes da execucao melhora rastreabilidade e seguranca operacional.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlanComposerOpen(true);
                    setPlanObjective(draft.trim());
                  }}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  Criar Plano (Recomendado)
                </button>
                <button
                  type="button"
                  onClick={() => setPlanHintDismissed(true)}
                  className="rounded-xl border border-kael-border px-3 py-1.5 text-xs hover:border-kael-accent/50"
                >
                  Seguir sem plano
                </button>
              </div>
            </div>
          )}
          {planComposerOpen && (
            <div className="mb-3 rounded-2xl border border-slate-300 bg-slate-100 p-4">
              <p className="mb-2 text-sm font-medium text-slate-900">Gerar plano para esta sessao</p>
              <label className="text-xs text-slate-600">Objetivo</label>
              <textarea
                value={planObjective}
                onChange={(event) => setPlanObjective(event.target.value)}
                className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-kael-accent"
              />
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-slate-600" htmlFor="planMaxSteps">
                  Max steps
                </label>
                <input
                  id="planMaxSteps"
                  type="number"
                  min={3}
                  max={12}
                  value={planMaxSteps}
                  onChange={(event) => setPlanMaxSteps(Number(event.target.value) || 8)}
                  className="w-20 rounded-xl border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-kael-accent"
                />
              </div>
              {createPlan.error && (
                <p className="mt-2 text-xs text-rose-700">
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
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  Gerar plano
                </button>
                <button
                  type="button"
                  disabled={createPlan.isPending}
                  onClick={() => {
                    void createPlan.mutateAsync({ openAfterCreate: true });
                  }}
                  className="rounded-xl border border-kael-border px-3 py-1.5 text-xs hover:border-kael-accent/50 disabled:opacity-60"
                >
                  Gerar e abrir Plans
                </button>
                <button
                  type="button"
                  onClick={() => setPlanComposerOpen(false)}
                  className="rounded-xl border border-kael-border px-3 py-1.5 text-xs hover:border-kael-accent/50"
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
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 outline-none focus:border-kael-accent font-reading"
            />
            <button
              type="submit"
              disabled={send.isPending}
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {send.isPending ? "Sending..." : "Send"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlanComposerOpen(true);
                setPlanObjective(draft.trim());
              }}
              className="rounded-xl border border-kael-border px-3 py-2 text-sm hover:border-kael-accent/50"
            >
              Plan
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
