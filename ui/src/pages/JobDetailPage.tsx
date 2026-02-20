import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import { cancelJob, getJob, getJobLog } from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

export function JobDetailPage(): JSX.Element {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? "";
  const queryClient = useQueryClient();

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: 2500,
  });
  const log = useQuery({
    queryKey: ["job-log", jobId],
    queryFn: () => getJobLog(jobId),
    enabled: Boolean(jobId),
    refetchInterval: 2000,
  });

  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });

  if (!jobId) {
    return <Panel title="Job">Missing job id.</Panel>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        title={`Job ${jobId.slice(0, 8)}`}
        right={
          <button
            className="rounded border border-kael-danger/50 px-2 py-1 text-xs text-orange-200 hover:bg-kael-danger/20 disabled:opacity-50"
            disabled={!job.data || !["running", "queued"].includes(job.data.status) || cancel.isPending}
            onClick={() => {
              void cancel.mutateAsync(jobId);
            }}
          >
            Cancel
          </button>
        }
      >
        {job.data && (
          <div className="space-y-2 text-sm">
            <p>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(job.data.status)}`}>
                {job.data.status}
              </span>
            </p>
            <p>Type: {job.data.type}</p>
            <p>Session: {job.data.sessionKey}</p>
            <p>Input: {job.data.input}</p>
            <p>Output: {job.data.output ?? "-"}</p>
            <p>Created: {formatDate(job.data.createdAt)}</p>
            <p>Started: {formatDate(job.data.startedAt)}</p>
            <p>Ended: {formatDate(job.data.endedAt)}</p>
            {job.data.error && <p className="text-orange-200">Error: {job.data.error}</p>}
          </div>
        )}
      </Panel>
      <div className="lg:col-span-2">
        <Panel title="Live Log (polling)">
          <pre className="kael-scroll max-h-[65vh] overflow-auto rounded-lg border border-kael-border bg-[#091521] p-3 font-mono text-xs leading-5 text-slate-200">
            {log.data ?? "No log data yet."}
          </pre>
        </Panel>
      </div>
    </div>
  );
}

