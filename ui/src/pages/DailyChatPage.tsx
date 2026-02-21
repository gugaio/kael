import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getSessionMessages, postChat } from "../lib/api";
import { formatDate } from "../lib/format";

export function DailyChatPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [sessionKey] = useState("main");
  const [draft, setDraft] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.data?.length, pendingUserMessage, send.isPending]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [sessionKey]);

  useEffect(() => {
    const node = listRef.current;
    if (!node || messages.isLoading) {
      return;
    }
    const frameA = window.requestAnimationFrame(() => {
      const frameB = window.requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
      });
      return () => window.cancelAnimationFrame(frameB);
    });
    return () => window.cancelAnimationFrame(frameA);
  }, [messages.isLoading, messages.data?.length]);

  return (
    <div className="min-h-screen bg-[#efeae2] px-4 pb-24 pt-24 text-black md:px-7 md:pt-28">
      <div className="fixed left-1/2 top-4 z-30 w-[min(96vw,860px)] -translate-x-1/2 rounded-2xl bg-[#111b21] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">Kael</h1>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black">Daily</span>
            <Link
              to="/chat"
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              Modo Ops
            </Link>
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <main ref={listRef} className="kael-scroll flex min-h-[72vh] flex-col gap-4 overflow-y-auto pb-44 pr-1">
          {(messages.data ?? []).map((item) => (
            <article
              key={item.id}
              className={`max-w-[94%] space-y-1 rounded-[18px] px-3 py-2 ${
                item.role === "user"
                  ? "ml-auto bg-[#d9fdd3] text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
                  : "bg-white text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
              }`}
            >
              <div
                className={`flex items-center justify-between gap-3 text-[11px] ${
                  item.role === "user" ? "text-[#4f5f5a]" : "text-[#667781]"
                }`}
              >
                <span className="font-medium">{item.role === "user" ? "voce" : item.role}</span>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-7 [overflow-wrap:anywhere]">{item.content}</p>
            </article>
          ))}
          {pendingUserMessage && (
            <>
              <article className="ml-auto max-w-[94%] space-y-1 rounded-[18px] bg-[#d9fdd3] px-3 py-2 text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
                <div className="flex items-center justify-between gap-3 text-[11px] text-[#4f5f5a]">
                  <span className="font-medium">voce</span>
                  <span>sending...</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-7 [overflow-wrap:anywhere]">
                  {pendingUserMessage}
                </p>
              </article>
              <article className="max-w-[94%] space-y-1 rounded-[18px] bg-white px-3 py-2 text-black shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
                <div className="flex items-center justify-between gap-3 text-[11px] text-[#667781]">
                  <span className="font-medium">assistant</span>
                  <span>thinking...</span>
                </div>
                <div className="flex items-center gap-1 py-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#666]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#666] [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#666] [animation-delay:240ms]" />
                </div>
              </article>
            </>
          )}
          {(messages.data ?? []).length === 0 && (
            <p className="pt-8 text-sm text-[#666]">Comece a conversa com Kael.</p>
          )}
          {sendError && <p className="text-xs text-rose-700">{sendError}</p>}
          <div ref={messagesEndRef} className="h-52 shrink-0" />
        </main>
      </div>

      <div className="fixed bottom-4 left-1/2 z-20 w-[min(96vw,860px)] -translate-x-1/2">
        <form onSubmit={onSubmit}>
          <div className="flex items-center gap-2 rounded-full border border-[#e6e6e6] bg-white px-2 py-2 shadow-[0_6px_16px_rgba(0,0,0,0.14)]">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Fale com Kael..."
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-black outline-none placeholder:text-[#666]"
            />
            <button
              type="submit"
              disabled={send.isPending}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#111b21] text-sm text-white disabled:opacity-60"
              aria-label="Enviar mensagem"
            >
              {send.isPending ? "…" : "➤"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
