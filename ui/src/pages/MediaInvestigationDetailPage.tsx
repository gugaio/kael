import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import {
  AgentAvatar,
  TypingDots,
  agentPersona,
  agentStateLabel,
  severityDot,
} from "../components/investigation";
import {
  getMediaInvestigation,
  rerunMediaInvestigation,
  type MediaInvestigation,
  type MediaInvestigationAgent,
} from "../lib/api";
import { formatDurationMs, timeAgo } from "../lib/format";
import { StateBadge } from "./MediaInvestigationsPage";

type MediaActivity = NonNullable<MediaInvestigation["activities"]>[number];

type FeedEvent =
  | { kind: "report"; at: string }
  | { kind: "agent"; at: string; agent: MediaInvestigationAgent }
  | { kind: "activity"; at: string; activity: MediaActivity };

export function MediaInvestigationDetailPage(): JSX.Element {
  const { investigationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const investigation = useQuery({
    queryKey: ["media-investigation", investigationId],
    queryFn: () => getMediaInvestigation(investigationId),
    enabled: Boolean(investigationId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state && !["completed", "failed"].includes(state) ? 1_500 : false;
    },
  });
  const rerun = useMutation({
    mutationFn: () => rerunMediaInvestigation(investigationId),
    onSuccess: async (record) => {
      await queryClient.invalidateQueries({ queryKey: ["media-investigations"] });
      navigate(`/investigations/${encodeURIComponent(record.id)}`);
    },
  });
  const data = investigation.data;

  const feed: FeedEvent[] = data ? buildFeed(data) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link to="/investigations" className="text-sm text-kael-accent underline">← Voltar ao feed</Link>
        {data && (
          <button
            type="button"
            onClick={() => rerun.mutate()}
            disabled={rerun.isPending || !["completed", "failed"].includes(data.state)}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {rerun.isPending ? "Criando nova execução..." : "🔁 Reexecutar com prompts atuais"}
          </button>
        )}
      </div>

      {investigation.isLoading && <Panel title="Timeline"><p className="text-sm text-kael-muted">Abrindo a sala de investigação...</p></Panel>}
      {investigation.error && <Panel title="Timeline"><p className="text-sm text-rose-700">{(investigation.error as Error).message}</p></Panel>}

      {data && (
        <>
          <div className="rounded-3xl border border-kael-border bg-white p-5 shadow-glow">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-kael-text">Caso {data.originId}</h1>
              <StateBadge state={data.state} />
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-kael-muted">{data.id}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-kael-muted">
              <span>aberto {timeAgo(data.createdAt)}</span>
              <span>atualizado {timeAgo(data.updatedAt)}</span>
              {data.evidence && (
                <span>
                  {data.evidence.summary.segmentCount} segments · {data.evidence.summary.variantCount} variants · {data.evidence.evidenceIndex.length} evidências
                </span>
              )}
            </div>
            {data.error && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{data.error}</p>}
          </div>

          <div className="relative space-y-4 before:absolute before:bottom-8 before:left-[21px] before:top-8 before:w-px before:bg-gradient-to-b before:from-slate-200 before:via-blue-200 before:to-indigo-200">
            {feed.map((event, index) => {
              if (event.kind === "report") {
                return <ReportPost key="report" data={data} />;
              }
              if (event.kind === "activity") {
                return <ActivityPost key={event.activity.id} activity={event.activity} />;
              }
              return <AgentPost key={event.agent.id} investigationId={data.id} agent={event.agent} isLast={index === feed.length - 1} />;
            })}
          </div>

          {data.evidence?.derived?.avOffsetSeries && data.evidence.derived.avOffsetSeries.length > 0 && (
            <Panel title="Anexo técnico · A/V Offset por segmento">
              <div className="grid gap-3 xl:grid-cols-2">
                {data.evidence.derived.avOffsetSeries.map((series) => (
                  <div key={series.id} className="rounded-xl border border-kael-border bg-kael-panelSoft p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="text-sm font-medium text-kael-text">{series.audioLabel} vs {series.videoLabel}</p><p className="font-mono text-[10px] text-kael-muted">{series.id}</p></div>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{series.pattern}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Metric value={signedSeconds(series.medianOffsetSeconds)} label="median" />
                      <Metric value={`${series.offsetSpreadSeconds.toFixed(3)}s`} label="spread" />
                      <Metric value={String(series.sampleCount)} label="samples" />
                    </div>
                    <div className="mt-3 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto kael-scroll">
                      {series.samples.map((sample) => <span key={sample.segmentIndex} className="rounded-md border border-kael-border bg-white px-2 py-1 font-mono text-[10px] text-kael-text">s{sample.segmentIndex}: {signedSeconds(sample.offsetSeconds)}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {data.evidence && (
            <Panel title="Anexo técnico · Evidence Index">
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 kael-scroll">
                {data.evidence.evidenceIndex.map((evidence) => (
                  <div key={evidence.id} className="grid gap-1 rounded-xl border border-kael-border bg-kael-panelSoft p-3 sm:grid-cols-[180px_90px_1fr] sm:items-center">
                    <span className="font-mono text-xs text-blue-700">{evidence.id}</span>
                    <span className="text-xs uppercase tracking-wide text-kael-muted">{evidence.kind}</span>
                    <span className="text-sm text-kael-text">{evidence.summary}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function buildFeed(data: MediaInvestigation): FeedEvent[] {
  const events: FeedEvent[] = [{ kind: "report", at: data.createdAt }];
  for (const agent of data.agents) {
    events.push({ kind: "agent", at: agent.startedAt ?? data.createdAt, agent });
  }
  for (const activity of data.activities ?? []) {
    events.push({ kind: "activity", at: activity.startedAt, activity });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

function PostShell(props: { avatar: JSX.Element; children: ReactNode; highlight?: boolean }): JSX.Element {
  return (
    <article className="relative pl-14">
      <span className="absolute left-0 top-0">{props.avatar}</span>
      <div className={`rounded-3xl border p-4 shadow-sm ${props.highlight ? "border-indigo-300 bg-gradient-to-br from-indigo-50 via-white to-blue-50" : "border-kael-border bg-white"}`}>
        {props.children}
      </div>
    </article>
  );
}

function PostHeader(props: { name: string; handle: string; at?: string; right?: ReactNode }): JSX.Element {
  return (
    <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="text-sm font-semibold text-kael-text">{props.name}</p>
      <p className="text-xs text-kael-muted">{props.handle}</p>
      {props.at && <p className="text-xs text-kael-muted">· {timeAgo(props.at)}</p>}
      {props.right && <span className="ml-auto">{props.right}</span>}
    </header>
  );
}

function ReportPost(props: { data: MediaInvestigation }): JSX.Element {
  const { data } = props;
  return (
    <PostShell avatar={<span className="flex h-11 w-11 select-none items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-600 text-xl shadow-sm ring-2 ring-slate-200">🧑‍💻</span>}>
      <PostHeader name="Você" handle="@relato" at={data.createdAt} />
      <p className="mt-2 text-[15px] leading-6 text-kael-text">“{data.problemStatement ?? "Triagem geral da mídia"}”</p>
      {data.problemContext?.approximateTime && (
        <p className="mt-2 text-xs text-kael-muted">⏱️ Momento aproximado: {data.problemContext.approximateTime}</p>
      )}
      <p className="mt-3 border-t border-kael-border pt-2 text-xs text-kael-muted">O time foi convocado para investigar este caso 🔍</p>
    </PostShell>
  );
}

function AgentPost(props: { investigationId: string; agent: MediaInvestigationAgent; isLast: boolean }): JSX.Element {
  const { agent } = props;
  const persona = agentPersona(agent);
  const agentUrl = `/investigations/${encodeURIComponent(props.investigationId)}/agents/${encodeURIComponent(agent.id)}`;
  const at = agent.completedAt ?? agent.startedAt;
  return (
    <PostShell avatar={<AgentAvatar agent={agent} />} highlight={agent.role === "synthesizer" && agent.state === "completed"}>
      <PostHeader
        name={agent.label}
        handle={persona.handle}
        at={at}
        right={<span className="text-xs text-kael-muted">{agentStateLabel(agent.state)}{agent.durationMs !== undefined ? ` · ${formatDurationMs(agent.durationMs)}` : ""}</span>}
      />

      {agent.state === "running" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-blue-700"><TypingDots /> {persona.tagline} analisando evidências...</p>
      )}
      {agent.state === "queued" && <p className="mt-3 text-sm text-kael-muted">Aguardando a vez de entrar em cena.</p>}
      {agent.error && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{agent.error}</p>}

      {agent.output && (
        <div className="mt-2">
          <p className="text-[15px] leading-6 text-kael-text">{agent.output.summary}</p>
          {agent.output.findings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {agent.output.findings.slice(0, 3).map((finding, index) => (
                <li key={`${finding.code}-${index}`} className="flex items-start gap-2 text-sm text-kael-text">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot(finding.severity)}`} />
                  <span><span className="font-mono text-xs text-kael-muted">{finding.code}</span> — {finding.summary}</span>
                </li>
              ))}
              {agent.output.findings.length > 3 && (
                <li className="text-xs text-kael-muted">+{agent.output.findings.length - 3} achados na análise completa</li>
              )}
            </ul>
          )}
        </div>
      )}

      {agent.synthesis && (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Conclusão da investigação</p>
          <p className="mt-2 text-[15px] font-medium leading-6 text-kael-text">{agent.synthesis.summary}</p>
          <div className="mt-3 rounded-2xl border border-indigo-100 bg-white/80 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-indigo-600">Causa provável</p>
            <p className="mt-1 text-sm font-medium text-kael-text">{agent.synthesis.likelyCause}</p>
            <p className="mt-2 text-xs text-kael-muted">Confiança: {Math.round(agent.synthesis.confidence * 100)}%</p>
          </div>
          {agent.synthesis.causalChain && agent.synthesis.causalChain.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-kael-text">
              {agent.synthesis.causalChain.map((step, index) => (
                <span key={index} className="contents">
                  <span className="rounded-lg border border-indigo-100 bg-white px-2 py-1">{step}</span>
                  {index < agent.synthesis!.causalChain!.length - 1 && <span className="text-indigo-300">→</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(agent.output || agent.synthesis) && (
        <p className="mt-3 border-t border-kael-border pt-2">
          <Link to={agentUrl} className="text-sm font-medium text-kael-accent hover:underline">Ver análise completa →</Link>
        </p>
      )}
    </PostShell>
  );
}

function ActivityPost(props: { activity: MediaActivity }): JSX.Element {
  const { activity } = props;
  const stateChip = activity.state === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : activity.state === "running"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-rose-200 bg-rose-50 text-rose-700";
  return (
    <article className="relative pl-14">
      <span className="absolute left-1 top-0 flex h-9 w-9 select-none items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-sm shadow-sm ring-2 ring-indigo-100">🔬</span>
      <div className="rounded-2xl border border-dashed border-kael-border bg-kael-panelSoft p-3">
        <header className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-kael-text">Lead Investigator</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateChip}`}>{activity.state}</span>
          <span className="ml-auto text-[11px] text-kael-muted">{timeAgo(activity.startedAt)}</span>
        </header>
        <p className="mt-1.5 text-sm text-kael-text">
          Executou <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-100">{activity.tool}</code> — {activity.reason}
        </p>
        {activity.state === "running" && <div className="mt-2 overflow-hidden rounded-full bg-blue-100"><div className="h-1 w-2/3 animate-pulse rounded-full bg-blue-500" /></div>}
        {activity.summary && <p className="mt-1.5 text-xs text-kael-muted">{activity.summary}</p>}
        {activity.evidenceIds.length > 0 && (
          <p className="mt-1.5 break-all font-mono text-[10px] text-emerald-700">+{activity.evidenceIds.length} evidência(s): {activity.evidenceIds.join(" · ")}</p>
        )}
      </div>
    </article>
  );
}

function Metric(props: { value: string; label: string }): JSX.Element {
  return <div className="min-w-[76px] rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2"><p className="text-lg font-semibold text-kael-text">{props.value}</p><p className="text-[10px] uppercase tracking-wide text-kael-muted">{props.label}</p></div>;
}

function signedSeconds(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
}
