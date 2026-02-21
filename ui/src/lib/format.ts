export function formatDate(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function statusTone(status: string): string {
  switch (status) {
    case "running":
    case "in_progress":
    case "active":
      return "bg-cyan-500/20 text-cyan-200 border-cyan-400/40";
    case "queued":
    case "pending":
      return "bg-amber-500/20 text-amber-200 border-amber-400/40";
    case "succeeded":
    case "completed":
      return "bg-emerald-500/20 text-emerald-200 border-emerald-400/40";
    case "failed":
    case "blocked":
      return "bg-rose-500/20 text-rose-200 border-rose-400/40";
    case "canceled":
      return "bg-slate-500/20 text-slate-200 border-slate-300/40";
    default:
      return "bg-slate-500/20 text-slate-200 border-slate-300/40";
  }
}
