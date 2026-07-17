import type { MediaInvestigationAgent } from "../lib/api";

export type AgentPersona = {
  emoji: string;
  handle: string;
  tagline: string;
  avatar: string;
  chip: string;
};

const PERSONAS: Record<string, AgentPersona> = {
  "timeline-container": {
    emoji: "🎬",
    handle: "@timeline",
    tagline: "Especialista em timeline e container",
    avatar: "from-violet-500 to-fuchsia-500",
    chip: "border-violet-200 bg-violet-50 text-violet-700",
  },
  "audio-video": {
    emoji: "🎧",
    handle: "@av",
    tagline: "Especialista em áudio e vídeo",
    avatar: "from-sky-500 to-cyan-500",
    chip: "border-sky-200 bg-sky-50 text-sky-700",
  },
  "manifest-delivery": {
    emoji: "📡",
    handle: "@delivery",
    tagline: "Especialista em manifesto e entrega",
    avatar: "from-amber-500 to-orange-500",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
  },
  synthesizer: {
    emoji: "🕵️",
    handle: "@lead",
    tagline: "Lead Investigator",
    avatar: "from-indigo-600 to-blue-600",
    chip: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
};

const FALLBACK_PERSONA: AgentPersona = {
  emoji: "🤖",
  handle: "@agente",
  tagline: "Agente de investigação",
  avatar: "from-slate-500 to-slate-600",
  chip: "border-slate-200 bg-slate-50 text-slate-700",
};

export function agentPersona(agent: Pick<MediaInvestigationAgent, "id" | "label">): AgentPersona {
  return PERSONAS[agent.id] ?? FALLBACK_PERSONA;
}

export function agentStateLabel(state: string): string {
  switch (state) {
    case "queued":
      return "na fila";
    case "running":
      return "analisando...";
    case "completed":
      return "concluiu";
    case "failed":
      return "falhou";
    default:
      return state;
  }
}

export function AgentAvatar(props: {
  agent: Pick<MediaInvestigationAgent, "id" | "label" | "state">;
  size?: "sm" | "md" | "lg";
}): JSX.Element {
  const persona = agentPersona(props.agent);
  const size = props.size ?? "md";
  const dims = size === "lg" ? "h-14 w-14 text-3xl" : size === "sm" ? "h-8 w-8 text-sm" : "h-11 w-11 text-xl";
  const ring = props.agent.state === "running"
    ? "ring-4 ring-blue-200 animate-pulse"
    : props.agent.state === "completed"
      ? "ring-2 ring-emerald-200"
      : props.agent.state === "failed"
        ? "ring-2 ring-rose-200"
        : "ring-2 ring-slate-200";
  return (
    <span
      title={`${props.agent.label} (${agentStateLabel(props.agent.state)})`}
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br shadow-sm ${persona.avatar} ${dims} ${ring}`}
    >
      {persona.emoji}
    </span>
  );
}

export function TypingDots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1" aria-label="digitando">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500"
          style={{ animationDelay: `${dot * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function ConfidenceBar(props: { value: number }): JSX.Element {
  const percent = Math.round(props.value * 100);
  const tone = percent >= 70 ? "bg-emerald-500" : percent >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="text-xs text-kael-muted">{percent}%</span>
    </span>
  );
}

export function severityDot(severity: string): string {
  if (severity === "error") return "bg-rose-500";
  if (severity === "warning") return "bg-amber-500";
  return "bg-sky-500";
}

export function severityTone(severity: string): string {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}
