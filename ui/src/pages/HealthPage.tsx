import { useQuery } from "@tanstack/react-query";
import { Panel } from "../components/Panel";
import { getHealth } from "../lib/api";
import { formatDate } from "../lib/format";

export function HealthPage(): JSX.Element {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Core Health">
        {health.data && (
          <div className="space-y-2 text-sm">
            <p>service: {health.data.service}</p>
            <p>version: {health.data.version}</p>
            <p>engineMode: {health.data.engineMode}</p>
            <p>piEnabled: {String(health.data.piEnabled)}</p>
            <p>now: {formatDate(health.data.now)}</p>
          </div>
        )}
      </Panel>
      <Panel title="Operational Metrics">
        {health.data && (
          <div className="space-y-2 text-sm">
            <p>sessions: {health.data.metrics.sessions}</p>
            <p>totalJobs: {health.data.metrics.totalJobs}</p>
            <p>activeJobs: {health.data.metrics.runtimeJobs.activeJobs}</p>
            <p>queuedJobs: {health.data.metrics.runtimeJobs.queuedJobs}</p>
            <p>enabledSchedules: {health.data.metrics.schedules.enabled}</p>
          </div>
        )}
      </Panel>
      <div className="md:col-span-2">
        <Panel title="Jobs by Status">
          {health.data && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(health.data.metrics.jobsByStatus).map(([status, value]) => (
                <div key={status} className="rounded-lg border border-kael-border bg-kael-panelSoft p-2 text-sm">
                  <p className="text-xs uppercase tracking-wider text-kael-muted">{status}</p>
                  <p className="text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
