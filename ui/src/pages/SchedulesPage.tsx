import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "../components/Panel";
import { getSchedules, pauseSchedule, resumeSchedule } from "../lib/api";
import { formatDate } from "../lib/format";

export function SchedulesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const schedules = useQuery({ queryKey: ["schedules"], queryFn: getSchedules });

  const pause = useMutation({
    mutationFn: pauseSchedule,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
  const resume = useMutation({
    mutationFn: resumeSchedule,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  return (
    <Panel title="Schedules">
      <div className="space-y-3">
        {(schedules.data ?? []).map((schedule) => (
          <div key={schedule.id} className="rounded-xl border border-kael-border bg-kael-panelSoft p-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{schedule.id}</p>
                <p className="text-xs text-kael-muted">type: {schedule.type}</p>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  schedule.enabled
                    ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                    : "border-slate-400/40 bg-slate-500/20 text-slate-200"
                }`}
              >
                {schedule.enabled ? "enabled" : "paused"}
              </span>
            </div>
            <p className="text-xs text-kael-muted">next run: {formatDate(schedule.nextRunAt)}</p>
            <p className="mt-1 text-xs text-kael-muted">
              {schedule.schedule.kind === "interval"
                ? `interval ${schedule.schedule.intervalMs}ms`
                : `cron ${schedule.schedule.cronExpr}`}
            </p>
            <div className="mt-3">
              {schedule.enabled ? (
                <button
                  className="rounded border border-amber-300/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-400/20"
                  disabled={pause.isPending}
                  onClick={() => {
                    void pause.mutateAsync(schedule.id);
                  }}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="rounded border border-emerald-300/50 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-400/20"
                  disabled={resume.isPending}
                  onClick={() => {
                    void resume.mutateAsync(schedule.id);
                  }}
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        ))}
        {(schedules.data ?? []).length === 0 && <p className="text-sm text-kael-muted">No schedules found.</p>}
      </div>
    </Panel>
  );
}
