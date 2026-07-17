import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { approveExecApproval, denyExecApproval, getExecApprovals } from "../lib/api";
import { useLiveEvents } from "../lib/live-events";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/chat", label: "Chat" },
  { to: "/streams/watch", label: "Watch" },
  { to: "/streams", label: "Streams" },
  { to: "/investigations", label: "Investigações" },
  { to: "/plans", label: "Plans" },
  { to: "/jobs", label: "Jobs" },
  { to: "/exec", label: "Execuções" },
  { to: "/schedules", label: "Schedules" },
  { to: "/health", label: "Health" },
];

export function AppShell(props: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  useLiveEvents();
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
    <div className="dashboard-grid min-h-screen md:p-5">
      <div className="relative min-h-[calc(100vh-24px)] w-full">
        <aside className="rounded-[32px] border border-kael-border bg-kael-panel p-4 shadow-shell lg:fixed lg:left-5 lg:top-5 lg:h-[calc(100vh-40px)] lg:w-[280px] lg:overflow-y-auto">

          <nav className="mt-4 flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/" || item.to === "/streams"}
                className={({ isActive }) =>
                  [
                    "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "border-kael-accent bg-blue-50 text-blue-700 shadow-sm"
                      : "border-transparent text-kael-muted hover:border-kael-border hover:bg-kael-panelSoft hover:text-kael-text",
                  ].join(" ")
                }
              >
                <span>{item.label}</span>
                {item.to === "/" && pendingApprovals.length > 0 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    {pendingApprovals.length}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 rounded-[24px] border border-kael-border bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-kael-muted">Aprovacoes</p>
            <p className="mt-2 text-2xl font-semibold text-kael-text">{pendingApprovals.length}</p>
            <p className="mt-1 text-sm text-kael-muted">
              {pendingApprovals.length > 0 ? "Comandos aguardando decisao manual." : "Nenhum comando pendente agora."}
            </p>
          </div>
        </aside>

        <div className="mt-4 min-w-0 space-y-4 lg:mt-0 lg:flex lg:min-h-[calc(100vh-40px)] lg:flex-col lg:pl-[304px]">


          <main className="min-w-0 lg:flex-1 lg:min-h-0">{props.children}</main>
        </div>
        {firstApproval && (
          <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,460px)] rounded-[24px] border border-amber-200 bg-white p-4 shadow-shell">
            <p className="text-xs uppercase tracking-[0.22em] text-amber-700">Approval Required</p>
            <p className="mt-1 text-sm font-medium text-kael-text">
              {pendingApprovals.length} comando(s) aguardando aprovacao
            </p>
            <p className="mt-2 truncate text-xs text-kael-muted">{firstApproval.command}</p>
            <p className="truncate text-xs text-kael-muted">cwd: {firstApproval.cwd}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => approve.mutate(firstApproval.id)}
                disabled={approve.isPending || deny.isPending}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              >
                Approve now
              </button>
              <button
                type="button"
                onClick={() => deny.mutate(firstApproval.id)}
                disabled={approve.isPending || deny.isPending}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                Deny
              </button>
              <NavLink
                to="/"
                className="rounded-xl border border-kael-border px-3 py-1.5 text-xs font-medium text-kael-muted hover:border-kael-accent/40 hover:text-kael-text"
              >
                Open Ops
              </NavLink>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
