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
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-600"
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
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                  disabled={pause.isPending}
                  onClick={() => {
                    void pause.mutateAsync(schedule.id);
                  }}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
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
