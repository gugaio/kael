import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { getSessionMessages, postChat } from "../lib/api";
import { formatDate } from "../lib/format";

export function ChatPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [sessionKey, setSessionKey] = useState("main");
  const [draft, setDraft] = useState("");

  const messages = useQuery({
    queryKey: ["session-messages", sessionKey],
    queryFn: () => getSessionMessages(sessionKey),
    refetchInterval: 2500,
  });

  const send = useMutation({
    mutationFn: async () => postChat(sessionKey, draft.trim()),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["session-messages", sessionKey] });
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!draft.trim()) {
      return;
    }
    void send.mutateAsync();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Panel title="Session" right={<span className="text-xs text-kael-muted">polling 2.5s</span>}>
        <label className="text-xs text-kael-muted" htmlFor="sessionKey">Session key</label>
        <input
          id="sessionKey"
          value={sessionKey}
          onChange={(event) => setSessionKey(event.target.value || "main")}
          className="mt-2 w-full rounded border border-kael-border bg-kael-panelSoft px-2 py-1.5 text-sm outline-none focus:border-kael-accent"
        />
      </Panel>
      <div className="lg:col-span-3">
        <Panel title="Conversation">
          <div className="kael-scroll mb-3 max-h-[55vh] space-y-2 overflow-auto rounded-xl border border-kael-border bg-kael-panelSoft p-3">
            {(messages.data ?? []).map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-2 text-sm ${
                  item.role === "user"
                    ? "border-cyan-400/30 bg-cyan-500/10"
                    : item.role === "assistant"
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-amber-400/30 bg-amber-500/10"
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="uppercase tracking-wider text-kael-muted">{item.role}</span>
                  <span className="text-kael-muted">{formatDate(item.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap">{item.content}</p>
              </div>
            ))}
            {(messages.data ?? []).length === 0 && <p className="text-sm text-kael-muted">No messages yet.</p>}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Talk to Kael..."
              className="flex-1 rounded border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm outline-none focus:border-kael-accent"
            />
            <button
              type="submit"
              disabled={send.isPending}
              className="rounded border border-kael-accent/60 bg-kael-accent/20 px-3 py-2 text-sm font-medium hover:bg-kael-accent/30 disabled:opacity-60"
            >
              Send
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

