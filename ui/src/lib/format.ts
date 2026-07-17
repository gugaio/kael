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

export function timeAgo(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 45) return "agora";
  if (seconds < 3600) return `há ${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86400)} d`;
}

export function formatDurationMs(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function statusTone(status: string): string {
  switch (status) {
    case "running":
    case "in_progress":
    case "active":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "queued":
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "succeeded":
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
    case "blocked":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "canceled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}
