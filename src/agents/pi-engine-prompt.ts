import type { EngineTurnInput } from "./types.js";

function isSelfKnowledgeQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const tokens = [
    "framework",
    "agentic",
    "loop",
    "arquitetura",
    "stack",
    "pi-agent-core",
    "fastify",
    "como voce funciona",
    "internamente",
    "qual engine",
    "que agente code",
    "seu codigo",
    "seus arquivos",
  ];
  return tokens.some((token) => text.includes(token));
}

function isOperationalExecutionRequest(message: string): boolean {
  const text = message.toLowerCase();
  const tokens = [
    "executa",
    "execute",
    "roda",
    "rodar",
    "abre",
    "abrir",
    "toca",
    "tocar",
    "run ",
    "shell",
    "bash",
    "ffprobe",
    "ffmpeg",
  ];
  return tokens.some((token) => text.includes(token));
}

function isMemoryRecallQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const lexicalTriggers = [
    "meu ",
    "minha ",
    "meus ",
    "minhas ",
    "lembra",
    "lembrar",
    "como combinamos",
    "qual era",
    "qual é meu",
    "qual e meu",
    "qual é minha",
    "qual e minha",
    "time",
    "preferencia",
    "preferência",
    "gosto",
    "projeto",
    "decisao",
    "decisão",
    "historico",
    "histórico",
    "contexto anterior",
  ];
  return lexicalTriggers.some((token) => text.includes(token));
}

function buildMemoryRecallInstruction(currentMessage: string): string[] {
  return [
    "Pergunta com alta chance de depender de memoria detectada.",
    "Antes de responder, siga obrigatoriamente este fluxo de recall:",
    "1) Chame memory_search com uma consulta curta baseada na mensagem atual.",
    "2) Se houver resultado relevante, chame memory_get no path candidato para confirmar o texto fonte.",
    "3) Responda com base no que foi encontrado; nao invente fatos ausentes.",
    "4) Se nao achar evidencia suficiente, diga explicitamente que nao encontrou na memoria.",
    "Exemplos classicos de recall: 'qual meu time?', 'qual minha preferencia?', 'o que combinamos antes?'.",
    `Consulta sugerida para memory_search: "${currentMessage.slice(0, 140)}"`,
    "",
  ];
}

function buildWebToolingDisciplineInstruction(): string[] {
  return [
    "Disciplina obrigatoria para pesquisa web:",
    "1) Se a pergunta for aberta (resumo/destaques/estado atual), prefira web_research em vez de varias chamadas manuais.",
    "2) Evite repetir web_search em cadeia para cada manchete; busque e sintetize com o que ja tem.",
    "3) Se qualquer tool retornar blocked=true (budget/loop), pare de chamar tools e entregue resposta best-effort com evidencias coletadas.",
    "",
  ];
}

function isRuntimeStateQuestion(message: string): boolean {
  const text = message.toLowerCase();
  const triggers = [
    "ultimo job",
    "último job",
    "jobs",
    "transcode",
    "hls",
    "capture",
    "probe",
    "status do job",
    "log do job",
    "plano",
    "planos",
    "status do plano",
    "etapa do plano",
  ];
  return triggers.some((token) => text.includes(token));
}

function buildRuntimeStateInstruction(): string[] {
  return [
    "Pergunta sobre estado historico de jobs/planos detectada.",
    "Priorize tools de estado antes de shell/exec:",
    "1) Para jobs: use jobs_list, jobs_get e jobs_log_tail.",
    "2) Para planos: use plan_list e plan_get.",
    "3) So use exec/process se as tools de estado nao forem suficientes.",
    "",
  ];
}

export function buildPrompt(input: EngineTurnInput): string {
  const context = input.contextMessages ?? [];
  const needsMemoryRecall = isMemoryRecallQuestion(input.message);
  if (context.length === 0) {
    const leadingInstructions: string[] = [];
    if (needsMemoryRecall) {
      leadingInstructions.push(...buildMemoryRecallInstruction(input.message));
    }
    if (isSelfKnowledgeQuestion(input.message)) {
      leadingInstructions.push(
        "Pergunta sobre o proprio Kael detectada.",
        "Antes de responder, investigue o workspace com workspace_search e workspace_read e responda com evidencias (arquivo:linha).",
        "",
      );
    }
    if (isRuntimeStateQuestion(input.message)) {
      leadingInstructions.push(...buildRuntimeStateInstruction());
    }
    leadingInstructions.push(...buildWebToolingDisciplineInstruction());
    if (leadingInstructions.length === 0) {
      return input.message;
    }
    return [...leadingInstructions, "Mensagem atual do usuario:", input.message].join("\n");
  }

  const serializedContext = context
    .filter((item) => item.content.trim().length > 0)
    .map((item) => `[${item.role}] ${item.content}`)
    .join("\n");

  return [
    "Contexto recente da conversa (ordem cronologica):",
    serializedContext,
    "",
    ...(isSelfKnowledgeQuestion(input.message)
      ? [
          "Pergunta sobre o proprio Kael detectada.",
          "Antes de responder, investigue o workspace com workspace_search e workspace_read e responda com evidencias (arquivo:linha).",
          "",
        ]
      : []),
    ...(isRuntimeStateQuestion(input.message) ? buildRuntimeStateInstruction() : []),
    ...buildWebToolingDisciplineInstruction(),
    ...(needsMemoryRecall ? buildMemoryRecallInstruction(input.message) : []),
    "Instrucao critica: responda a MENSAGEM ATUAL do usuario. Nao continue tarefas antigas sem pedido explicito.",
    ...(isOperationalExecutionRequest(input.message)
      ? [
          "Instrucao operacional: o usuario pediu acao real. Use tools (exec/process) para executar e validar.",
          "Nao responda apenas com comando textual ou slash command sem executar.",
          "Ao gerar scripts Python em exec, use 'python3' (nao use 'python').",
        ]
      : []),
    "",
    "Mensagem atual do usuario:",
    input.message,
  ].join("\n");
}
