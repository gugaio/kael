import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import {
  approveExecApproval,
  denyExecApproval,
  getExecApprovals,
  getHealth,
  getJobs,
  getSchedules,
} from "../lib/api";
import { getEmailIngestAlertThresholds } from "../lib/email-ingest-alerts";
import { formatDate, statusTone } from "../lib/format";

export function OpsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: getJobs });
  const schedules = useQuery({ queryKey: ["schedules"], queryFn: getSchedules });
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

  const runningJobs = (jobs.data ?? []).filter((job) => job.status === "running" || job.status === "queued");
  const emailIngest = health.data?.metrics.emailIngest ?? null;
  const { duplicateSkipped: duplicateAlertThreshold, inFlightSkipped: inflightAlertThreshold } =
    getEmailIngestAlertThresholds();
  const hasEmailAlert = Boolean(
    emailIngest &&
      (emailIngest.duplicateSkipped >= duplicateAlertThreshold ||
        emailIngest.inFlightSkipped >= inflightAlertThreshold),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <Panel title="System Pulse">
        {health.isLoading && <p className="text-sm text-kael-muted">Loading health...</p>}
        {health.data && (
          <div className="space-y-2 text-sm">
            <p>
              Engine: <span className="font-semibold">{health.data.engineMode}</span>
            </p>
            <p>
              Uptime: <span className="font-semibold">{Math.floor(health.data.uptimeSec / 60)} min</span>
            </p>
            <p>
              Runtime:{" "}
              <span className="font-semibold">
                {health.data.metrics.runtimeJobs.activeJobs} active / {health.data.metrics.runtimeJobs.queuedJobs} queued
              </span>
            </p>
            <p>
              Schedules:{" "}
              <span className="font-semibold">
                {health.data.metrics.schedules.enabled} enabled / {health.data.metrics.schedules.total} total
              </span>
            </p>
            {emailIngest && (
              <>
                <p>
                  Email ingest:{" "}
                  <span className="font-semibold">
                    {emailIngest.processed} processed / {emailIngest.messagesSeen} seen
                  </span>
                </p>
                <p>
                  Email dedupe:{" "}
                  <span className={hasEmailAlert ? "font-semibold text-amber-700" : "font-semibold"}>
                    {emailIngest.duplicateSkipped} duplicate / {emailIngest.inFlightSkipped} in-flight
                  </span>
                </p>
              </>
            )}
            {!emailIngest && <p className="text-xs text-kael-muted">Email ingest telemetry unavailable.</p>}
            {hasEmailAlert && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                Alert: duplicate/in-flight skips acima do limiar. Verificar workers concorrentes e intervalo do poll.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Running Now" right={<Link className="text-xs text-kael-accent" to="/jobs">Open Jobs</Link>}>
        <div className="space-y-2">
          {runningJobs.length === 0 && <p className="text-sm text-kael-muted">No active jobs right now.</p>}
          {runningJobs.slice(0, 6).map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="block rounded-2xl border border-kael-border bg-kael-panelSoft p-3 text-sm hover:border-kael-accent/50"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{job.type}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(job.status)}`}>{job.status}</span>
              </div>
              <p className="truncate text-xs text-kael-muted">{job.id}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Next Schedule Runs" right={<Link className="text-xs text-kael-accent" to="/schedules">Open Schedules</Link>}>
        <div className="space-y-2">
          {(schedules.data ?? []).slice(0, 6).map((schedule) => (
            <div key={schedule.id} className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3 text-sm">
              <p className="font-medium">{schedule.id}</p>
              <p className="text-xs text-kael-muted">next: {formatDate(schedule.nextRunAt)}</p>
            </div>
          ))}
          {(schedules.data ?? []).length === 0 && <p className="text-sm text-kael-muted">No schedules found.</p>}
        </div>
      </Panel>

      <Panel title="Exec Approvals">
        <div className="space-y-2">
          {(approvals.data ?? []).length === 0 && (
            <p className="text-sm text-kael-muted">No pending approvals.</p>
          )}
          {(approvals.data ?? []).slice(0, 5).map((approval) => (
            <div key={approval.id} className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3 text-sm">
              <p className="truncate font-medium">{approval.command}</p>
              <p className="truncate text-xs text-kael-muted">cwd: {approval.cwd}</p>
              <p className="text-xs text-kael-muted">created: {formatDate(approval.createdAt)}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => approve.mutate(approval.id)}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => deny.mutate(approval.id)}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
