import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Panel } from "../components/Panel";
import { cancelJob, getJobs } from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

export function JobsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: getJobs });

  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  return (
    <Panel title="Jobs">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-kael-muted">
              <th className="pb-2 pr-4">Type</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Session</th>
              <th className="pb-2 pr-4">Created</th>
              <th className="pb-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data ?? []).map((job) => (
              <tr key={job.id} className="border-t border-kael-border/60">
                <td className="py-2 pr-4">
                  <Link to={`/jobs/${job.id}`} className="font-medium hover:text-kael-accent">
                    {job.type}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(job.status)}`}>{job.status}</span>
                </td>
                <td className="py-2 pr-4">{job.sessionKey}</td>
                <td className="py-2 pr-4 text-kael-muted">{formatDate(job.createdAt)}</td>
                <td className="py-2 pr-4">
                  <button
                    className="rounded border border-kael-danger/50 px-2 py-1 text-xs text-orange-200 hover:bg-kael-danger/20 disabled:opacity-50"
                    disabled={!["running", "queued"].includes(job.status) || cancel.isPending}
                    onClick={() => {
                      void cancel.mutateAsync(job.id);
                    }}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
