import type { ReactNode } from "react";

export function Panel(props: { title: string; children: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <section className="min-w-0 rounded-2xl border border-kael-border bg-kael-panel p-4">
      <header className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-kael-muted">{props.title}</h2>
        {props.right}
      </header>
      {props.children}
    </section>
  );
}
