import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Ops" },
  { to: "/jobs", label: "Jobs" },
  { to: "/schedules", label: "Schedules" },
  { to: "/chat", label: "Chat" },
  { to: "/health", label: "Health" },
];

export function AppShell(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="rounded-2xl border border-kael-border bg-kael-panel/80 p-4 shadow-glow backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-kael-muted">Kael Operator Console</p>
              <h1 className="text-2xl font-bold">Kael</h1>
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
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        <main>{props.children}</main>
      </div>
    </div>
  );
}
