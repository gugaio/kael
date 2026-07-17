import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import {
  AgentAvatar,
  ConfidenceBar,
  agentPersona,
  agentStateLabel,
  severityTone,
} from "../components/investigation";
import {
  getMediaInvestigation,
  type MediaInvestigation,
  type MediaInvestigationAgent,
} from "../lib/api";
import { formatDate, formatDurationMs } from "../lib/format";
import { StateBadge } from "./MediaInvestigationsPage";

export function MediaInvestigationAgentPage(): JSX.Element {
  const { investigationId = "", agentId = "" } = useParams();
  const investigation = useQuery({
    queryKey: ["media-investigation", investigationId],
    queryFn: () => getMediaInvestigation(investigationId),
    enabled: Boolean(investigationId),
  });
  const data = investigation.data;
  const agent = data?.agents.find((candidate) => candidate.id === agentId);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to={`/investigations/${encodeURIComponent(investigationId)}`} className="inline-block text-sm text-kael-accent underline">
        ← Voltar à timeline
      </Link>

      {investigation.isLoading && <Panel title="Análise"><p className="text-sm text-kael-muted">Carregando análise do agente...</p></Panel>}
      {investigation.error && <Panel title="Análise"><p className="text-sm text-rose-700">{(investigation.error as Error).message}</p></Panel>}
      {data && !agent && (
        <Panel title="Análise"><p className="text-sm text-rose-700">Agente <code className="font-mono">{agentId}</code> não encontrado nesta investigação.</p></Panel>
      )}

      {data && agent && <AgentAnalysis investigation={data} agent={agent} />}
    </div>
  );
}

function AgentAnalysis(props: { investigation: MediaInvestigation; agent: MediaInvestigationAgent }): JSX.Element {
  const { investigation, agent } = props;
  const persona = agentPersona(agent);
  const evidenceSummaries = buildEvidenceSummaries(investigation);

  return (
    <>
      <div className="rounded-3xl border border-kael-border bg-white p-5 shadow-glow">
        <div className="flex flex-wrap items-center gap-4">
          <AgentAvatar agent={agent} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-kael-text">{agent.label}</h1>
              <StateBadge state={agent.state} />
            </div>
            <p className="mt-0.5 text-sm text-kael-muted">{persona.handle} · {persona.tagline}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-kael-border pt-4 text-xs text-kael-muted sm:grid-cols-4">
          <Meta label="modelo" value={agent.model ?? "indisponível"} />
          <Meta label="prompt" value={`v${agent.prompt.version} · ${agent.prompt.hash}`} mono />
          <Meta label="duração" value={formatDurationMs(agent.durationMs)} />
          <Meta label="estado" value={agentStateLabel(agent.state)} />
        </dl>
        {(agent.startedAt || agent.completedAt) && (
          <p className="mt-3 text-xs text-kael-muted">
            {agent.startedAt ? `início ${formatDate(agent.startedAt)}` : ""}
            {agent.completedAt ? ` · fim ${formatDate(agent.completedAt)}` : ""}
          </p>
        )}
      </div>

      {agent.error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{agent.error}</div>
      )}

      {agent.output && (
        <Panel title="Resumo">
          <p className="font-reading text-[15px] leading-7 text-kael-text">{agent.output.summary}</p>
        </Panel>
      )}

      {agent.output && agent.output.findings.length > 0 && (
        <Panel title={`Achados (${agent.output.findings.length})`}>
          <div className="space-y-2">
            {agent.output.findings.map((finding, index) => (
              <div key={`${finding.code}-${index}`} className={`rounded-xl border p-3 ${severityTone(finding.severity)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{finding.code}</span>
                  <ConfidenceBar value={finding.confidence} />
                </div>
                <p className="mt-1 text-sm">{finding.summary}</p>
                <EvidenceRefs ids={finding.evidenceIds} summaries={evidenceSummaries} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {agent.output && agent.output.hypotheses.length > 0 && (
        <Panel title={`Hipóteses (${agent.output.hypotheses.length})`}>
          <div className="space-y-3">
            {agent.output.hypotheses.map((hypothesis, index) => (
              <div key={index} className="rounded-xl border border-kael-border bg-kael-panelSoft p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs text-blue-700">{hypothesis.code ?? "hypothesis"}</span>
                    {hypothesis.likelyStage && <span className="ml-2 text-xs text-kael-muted">{hypothesis.likelyStage}</span>}
                  </div>
                  <ConfidenceBar value={hypothesis.confidence} />
                </div>
                <p className="mt-2 text-sm leading-6 text-kael-text">{hypothesis.description}</p>
                {hypothesis.causalChain && hypothesis.causalChain.length > 0 && (
                  <p className="mt-2 text-xs text-kael-muted">{hypothesis.causalChain.join(" → ")}</p>
                )}
                <EvidenceRefs label="explica" ids={hypothesis.explainedEvidenceIds ?? hypothesis.supportingEvidenceIds} summaries={evidenceSummaries} tone="emerald" />
                {hypothesis.unexplainedEvidenceIds && hypothesis.unexplainedEvidenceIds.length > 0 && (
                  <EvidenceRefs label="não explica" ids={hypothesis.unexplainedEvidenceIds} summaries={evidenceSummaries} tone="amber" />
                )}
                {hypothesis.contradictingEvidenceIds.length > 0 && (
                  <EvidenceRefs label="contradiz" ids={hypothesis.contradictingEvidenceIds} summaries={evidenceSummaries} tone="rose" />
                )}
                {hypothesis.predictedObservations && hypothesis.predictedObservations.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">Observações previstas</p>
                    <ul className="mt-1 space-y-1 text-sm text-kael-text">
                      {hypothesis.predictedObservations.map((observation, observationIndex) => <li key={observationIndex}>• {observation}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {agent.output && (agent.output.requestedChecks.length > 0 || agent.output.limitations.length > 0) && (
        <Panel title="Checks pedidos e limitações">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryList title="Checks solicitados" items={agent.output.requestedChecks} />
            <SummaryList title="Limitações" items={agent.output.limitations} />
          </div>
        </Panel>
      )}

      {agent.synthesis && (
        <Panel title="Síntese completa do Lead">
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-semibold text-kael-text">Conclusão da equipe</p>
              <ConfidenceBar value={agent.synthesis.confidence} />
            </div>
            <p className="mt-3 text-sm leading-6 text-kael-text">{agent.synthesis.summary}</p>
            <div className="mt-4 rounded-xl border border-indigo-100 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-indigo-600">Causa provável</p>
              <p className="mt-1 text-sm font-medium text-kael-text">{agent.synthesis.likelyCause}</p>
            </div>
            {agent.synthesis.perceptualImpact && (
              <div className="mt-3 rounded-xl border border-indigo-100 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-indigo-600">Impacto perceptual</p>
                <p className="mt-1 text-sm text-kael-text">{agent.synthesis.perceptualImpact}</p>
              </div>
            )}
            {agent.synthesis.causalChain && agent.synthesis.causalChain.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Cadeia causal</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-kael-text">
                  {agent.synthesis.causalChain.map((step, index) => (
                    <span key={index} className="contents">
                      <span className="rounded-lg border border-indigo-100 bg-white px-3 py-2">{step}</span>
                      {index < agent.synthesis!.causalChain!.length - 1 && <span className="text-indigo-300">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {agent.synthesis.rankedHypotheses && agent.synthesis.rankedHypotheses.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Hipóteses concorrentes</p>
                  {typeof agent.synthesis.evidenceCoverage === "number" && (
                    <span className="text-xs text-indigo-700">{Math.round(agent.synthesis.evidenceCoverage * 100)}% cobertura</span>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {agent.synthesis.rankedHypotheses.map((hypothesis, index) => (
                    <div key={`${hypothesis.code}-${index}`} className="rounded-xl border border-indigo-100 bg-white/80 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-indigo-700">#{index + 1} {hypothesis.code}</span>
                        <ConfidenceBar value={hypothesis.confidence} />
                      </div>
                      <p className="mt-1 text-sm text-kael-text">{hypothesis.description}</p>
                      <EvidenceRefs label="explica" ids={hypothesis.explainedEvidenceIds} summaries={evidenceSummaries} tone="emerald" />
                      {hypothesis.contradictingEvidenceIds.length > 0 && (
                        <EvidenceRefs label="contradiz" ids={hypothesis.contradictingEvidenceIds} summaries={evidenceSummaries} tone="rose" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {agent.synthesis.unresolvedEvidenceIds && agent.synthesis.unresolvedEvidenceIds.length > 0 && (
              <EvidenceRefs label="evidências sem explicação" ids={agent.synthesis.unresolvedEvidenceIds} summaries={evidenceSummaries} tone="amber" />
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <SummaryList title="Consenso" items={agent.synthesis.consensus} />
              <SummaryList title="Divergências" items={agent.synthesis.disagreements} />
              <SummaryList title="Próximos testes" items={agent.synthesis.nextSteps} />
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Anexo técnico">
        <div className="space-y-3">
          {agent.rawOutput && (
            <details className="rounded-xl border border-kael-border bg-kael-panelSoft">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-kael-muted">Saída bruta do modelo</summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-kael-border p-3 font-mono text-[11px] leading-5 text-slate-700 kael-scroll">{agent.rawOutput}</pre>
            </details>
          )}
          <details className="rounded-xl border border-kael-border bg-kael-panelSoft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-kael-muted">System prompt · v{agent.prompt.version} · {agent.prompt.hash}</summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-kael-border p-3 font-mono text-[11px] leading-5 text-slate-700 kael-scroll">{agent.prompt.content}</pre>
          </details>
        </div>
      </Panel>
    </>
  );
}

function buildEvidenceSummaries(investigation: MediaInvestigation): Map<string, string> {
  const summaries = new Map<string, string>();
  for (const evidence of investigation.evidence?.evidenceIndex ?? []) {
    summaries.set(evidence.id, evidence.summary);
  }
  for (const item of investigation.evidence?.derived?.contentQa ?? []) {
    summaries.set(item.id, item.summary);
  }
  return summaries;
}

function EvidenceRefs(props: {
  ids: string[];
  summaries: Map<string, string>;
  label?: string;
  tone?: "emerald" | "amber" | "rose";
}): JSX.Element | null {
  if (props.ids.length === 0) return null;
  const tone = props.tone ?? "emerald";
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <div className="mt-2">
      {props.label && <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-kael-muted">{props.label}</p>}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {props.ids.map((id) => (
          <span
            key={id}
            title={props.summaries.get(id) ?? id}
            className={`cursor-help rounded-md border px-2 py-0.5 font-mono text-[10px] ${tones[tone]}`}
          >
            {id}
          </span>
        ))}
      </div>
    </div>
  );
}

function Meta(props: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="uppercase tracking-[0.18em]">{props.label}</dt>
      <dd className={`mt-1 break-all text-kael-text ${props.mono ? "font-mono" : ""}`}>{props.value}</dd>
    </div>
  );
}

function SummaryList(props: { title: string; items: string[] }): JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">{props.title}</p>
      <ul className="mt-2 space-y-2 text-sm text-kael-text">
        {props.items.length === 0
          ? <li className="text-kael-muted">Nenhum item.</li>
          : props.items.map((item, index) => <li key={index} className="flex gap-2"><span>•</span><span>{item}</span></li>)}
      </ul>
    </div>
  );
}
