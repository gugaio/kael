import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "../components/Panel";
import { getExecSessionLog, getExecSessions } from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

const statusFilters = ["all", "running", "completed", "failed", "timed_out", "approval-pending", "denied", "canceled"];

export function ExecSessionsPage(): JSX.Element {
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string>("");

  const sessions = useQuery({
    queryKey: ["exec-sessions", status],
    queryFn: () => getExecSessions({ status, limit: 150 }),
    refetchInterval: 2500,
  });

  const selected = useMemo(
    () => (sessions.data ?? []).find((item) => item.id === selectedId) ?? (sessions.data ?? [])[0],
    [sessions.data, selectedId],
  );

  const log = useQuery({
    queryKey: ["exec-session-log", selected?.id ?? ""],
    queryFn: () => getExecSessionLog({ sessionId: selected?.id ?? "", limit: 12000 }),
    enabled: Boolean(selected?.id),
    refetchInterval: selected?.status === "running" ? 1500 : false,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        title="Execuções"
        right={(
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-1.5 text-xs text-kael-text"
          >
            {statusFilters.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        )}
      >
        <div className="kael-scroll max-h-[68vh] overflow-auto pr-1">
          {(sessions.data ?? []).length === 0 && <p className="text-sm text-kael-muted">Sem execuções recentes.</p>}
          {(sessions.data ?? []).map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setSelectedId(session.id)}
              className={[
                "mb-2 w-full rounded-lg border p-3 text-left",
                selected?.id === session.id
                  ? "border-kael-accent bg-blue-50"
                  : "border-kael-border bg-kael-panelSoft hover:border-kael-accent/40",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(session.status)}`}>
                  {session.status}
                </span>
                <span className="text-[11px] text-kael-muted">{formatDate(session.startedAt)}</span>
              </div>
              <p className="mt-2 truncate font-mono text-xs text-kael-text">{session.command}</p>
              <p className="truncate text-[11px] text-kael-muted">{session.cwd}</p>
              {session.failureCode && session.failureCode !== "none" && (
                <p className="mt-1 text-[11px] text-rose-700">failure: {session.failureCode}</p>
              )}
            </button>
          ))}
        </div>
      </Panel>

      <div className="lg:col-span-2">
        <Panel title={selected ? `Detalhe ${selected.id.slice(0, 8)}` : "Detalhe"}>
          {!selected && <p className="text-sm text-kael-muted">Selecione uma execução.</p>}
          {selected && (
            <>
              <div className="mb-3 grid gap-2 text-sm md:grid-cols-2">
                <p>
                  Status: <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(selected.status)}`}>{selected.status}</span>
                </p>
                <p>Exit code: {selected.exitCode ?? "-"}</p>
                <p>Started: {formatDate(selected.startedAt)}</p>
                <p>Ended: {formatDate(selected.endedAt)}</p>
                <p>Failure: {selected.failureCode ?? "none"}</p>
                <p>Approval: {selected.approvalId ?? "-"}</p>
              </div>
              <p className="mb-2 truncate rounded border border-kael-border bg-kael-panelSoft px-2 py-1 font-mono text-xs">
                {selected.command}
              </p>
              <pre className="kael-scroll max-h-[52vh] overflow-auto rounded-2xl border border-kael-border bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
                {(log.data?.output || log.data?.session.outputTail || "").trim() || "Sem output."}
              </pre>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
