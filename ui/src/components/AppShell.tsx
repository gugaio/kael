import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { approveExecApproval, denyExecApproval, getExecApprovals } from "../lib/api";
import { useLiveEvents } from "../lib/live-events";

const navItems = [
  { to: "/", label: "Ops" },
  { to: "/plans", label: "Plans" },
  { to: "/jobs", label: "Jobs" },
  { to: "/schedules", label: "Schedules" },
  { to: "/chat", label: "Chat" },
  { to: "/health", label: "Health" },
];

export function AppShell(props: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const live = useLiveEvents();
  const approvals = useQuery({
    queryKey: ["exec-approvals-open"],
    queryFn: () => getExecApprovals("open"),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => approveExecApproval(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exec-approvals-open"] });
    },
  });

  const deny = useMutation({
    mutationFn: async (id: string) => denyExecApproval(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exec-approvals-open"] });
    },
  });

  const pendingApprovals = approvals.data ?? [];
  const firstApproval = pendingApprovals[0];

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="rounded-2xl border border-kael-border bg-kael-panel/80 p-4 shadow-glow backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-kael-muted">Kael Operator Console</p>
              <h1 className="text-2xl font-bold">Kael</h1>
              <p className="mt-1 text-xs text-kael-muted">
                realtime: {live.mode}
                {live.lastEventAt ? ` • last event ${new Date(live.lastEventAt).toLocaleTimeString()}` : ""}
              </p>
            </div>
            <nav className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      isActive
                        ? "border-kael-accent bg-kael-accent/20 text-kael-text"
                        : "border-kael-border bg-kael-panelSoft text-kael-muted hover:text-kael-text",
                    ].join(" ")
                  }
                >
                  {item.label}
                  {item.to === "/" && pendingApprovals.length > 0 && (
                    <span className="ml-2 rounded-full border border-amber-400/50 bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                      {pendingApprovals.length}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        {firstApproval && (
          <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,460px)] rounded-xl border border-amber-400/40 bg-kael-panel p-3 shadow-glow">
            <p className="text-xs uppercase tracking-wider text-amber-200">Approval Required</p>
            <p className="mt-1 text-sm text-kael-text">{pendingApprovals.length} comando(s) aguardando aprovacao</p>
            <p className="mt-2 truncate text-xs text-kael-muted">{firstApproval.command}</p>
            <p className="truncate text-xs text-kael-muted">cwd: {firstApproval.cwd}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => approve.mutate(firstApproval.id)}
                disabled={approve.isPending || deny.isPending}
                className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-60"
              >
                Approve now
              </button>
              <button
                type="button"
                onClick={() => deny.mutate(firstApproval.id)}
                disabled={approve.isPending || deny.isPending}
                className="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-60"
              >
                Deny
              </button>
              <NavLink
                to="/"
                className="rounded border border-kael-border px-2 py-1 text-xs text-kael-muted hover:border-kael-accent/50 hover:text-kael-text"
              >
                Open Ops
              </NavLink>
            </div>
          </div>
        )}
        <main>{props.children}</main>
      </div>
    </div>
  );
}
