import { kaelLogger } from "../infra/logger.js";
import { extractProjectMention, type ProjectContextService, type ProjectDocument } from "./service.js";

const PROJECT_KNOWLEDGE_MAX_NOTES = 2;
const PROJECT_KNOWLEDGE_MIN_SCORE = 10;
const PROJECT_CONTEXT_MAX_CHARS = 1400;

export type ProjectHint = {
  projectName: string;
  cleanedMessage: string;
};

function buildProjectDocumentsContextBlock(docs: ProjectDocument[]): string {
  const lines = [
    "[project_documents_context]",
    "Use estes documentos do project space apenas se forem relevantes para responder a pergunta atual.",
  ];

  for (const [index, doc] of docs.entries()) {
    lines.push(
      "",
      `${index + 1}. project=${doc.project} path=${doc.path} updatedAt=${doc.updatedAt}`,
      `title=${doc.title}`,
      `description=${doc.description}`,
      doc.content.trim().slice(0, PROJECT_CONTEXT_MAX_CHARS),
    );
  }

  return lines.join("\n");
}

function buildProjectOverviewContextBlock(project: { name: string; content: string; filePath: string }): string {
  const trimmedContent = project.content.trim().slice(0, PROJECT_CONTEXT_MAX_CHARS);
  return [
    "[project_context]",
    `project=${project.name}`,
    `file=${project.filePath}`,
    "Use este contexto do projeto quando ele ajudar a interpretar a pergunta atual.",
    trimmedContent,
  ].join("\n");
}

function buildProjectScopeContextBlock(project: { name: string; cleanedMessage: string }): string {
  return [
    "[project_scope]",
    `project=${project.name}`,
    "Use este projeto como escopo padrao para project tools e skills que escrevem no project space.",
    project.cleanedMessage ? `user_message=${project.cleanedMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildProjectDocumentPolicyBlock(): string {
  return [
    "[project_document_policy]",
    "No project space, prefira atualizar documentos existentes.",
    "Se um novo .md parecer melhor e a intencao do usuario nao estiver clara, pergunte de forma curta antes de criar.",
    "Se o usuario ja tiver pedido ou confirmado explicitamente um arquivo .md especifico, voce pode seguir com esse caminho.",
  ].join("\n");
}

function extractMarkdownDocumentIntent(message: string): { path: string; state: "requested" | "approved" } | null {
  const pathMatch = message.match(/\b([A-Za-z0-9._/-]+\.md)\b/);
  const path = pathMatch?.[1]?.trim();
  if (!path) {
    return null;
  }
  const normalized = message.toLowerCase();
  const approved =
    /\b(aprovad[oa]|pode criar|pode seguir|segue com|sim[, ]+cria|sim[, ]+pode criar)\b/.test(normalized);
  if (approved) {
    return { path, state: "approved" };
  }
  const requested = /\b(criar|crie|novo arquivo|novo md|novo markdown)\b/.test(normalized);
  if (requested) {
    return { path, state: "requested" };
  }
  return null;
}

function buildProjectDocumentIntentBlock(params: { project: string; path: string; state: "requested" | "approved" }): string {
  return [
    "[project_document_intent]",
    `project=${params.project}`,
    `path=${params.path}`,
    `state=${params.state}`,
  ].join("\n");
}

export class ProjectPromptContextBuilder {
  constructor(private readonly projects: ProjectContextService) {}

  extractMention(message: string): ProjectHint | null {
    return extractProjectMention(message);
  }

  async appendMentionedProjectContext(input: {
    sessionKey: string;
    requestId?: string;
    originalMessage: string;
    message: string;
    projectHint: ProjectHint;
  }): Promise<string> {
    let nextMessage = `${input.message}\n\n${buildProjectScopeContextBlock({
      name: input.projectHint.projectName,
      cleanedMessage: input.projectHint.cleanedMessage,
    })}`;
    nextMessage = `${nextMessage}\n\n${buildProjectDocumentPolicyBlock()}`;
    const docIntent = extractMarkdownDocumentIntent(input.originalMessage);
    if (docIntent) {
      nextMessage = `${nextMessage}\n\n${buildProjectDocumentIntentBlock({
        project: input.projectHint.projectName,
        path: docIntent.path,
        state: docIntent.state,
      })}`;
    }

    const contextBlocks = await this.buildMentionedProjectContextBlocks({
      sessionKey: input.sessionKey,
      requestId: input.requestId,
      originalMessage: input.originalMessage,
      llmInputMessage: nextMessage,
      projectName: input.projectHint.projectName,
    });
    if (contextBlocks.length === 0) {
      return nextMessage;
    }
    return `${nextMessage}\n\n${contextBlocks.join("\n\n")}`;
  }

  private async buildMentionedProjectContextBlocks(input: {
    sessionKey: string;
    requestId?: string;
    originalMessage: string;
    llmInputMessage: string;
    projectName: string;
  }): Promise<string[]> {
    const blocks: string[] = [];

    try {
      const project = await this.projects.ensureProject(input.projectName);
      blocks.push(buildProjectOverviewContextBlock(project));
      const results = await this.projects.search({
        query: input.originalMessage,
        project: input.projectName,
        maxResults: PROJECT_KNOWLEDGE_MAX_NOTES,
      });
      const strongMatches = results
        .filter((item) => item.score >= PROJECT_KNOWLEDGE_MIN_SCORE)
        .slice(0, PROJECT_KNOWLEDGE_MAX_NOTES);
      if (strongMatches.length === 0) {
        return blocks;
      }

      const docs = (
        await Promise.all(
          strongMatches.map((item) => this.projects.getDocument(item.project, item.path)),
        )
      ).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (docs.length === 0) {
        return blocks;
      }

      kaelLogger.info("chat.project_documents.context_applied", {
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        projectName: input.projectName ?? null,
        docs: docs.map((item) => `${item.project}/${item.path}`),
        query: input.originalMessage,
        llmChars: input.llmInputMessage.length,
      });
      blocks.push(buildProjectDocumentsContextBlock(docs));
      return blocks;
    } catch (error) {
      kaelLogger.warn("chat.project_documents.context_failed", {
        sessionKey: input.sessionKey,
        requestId: input.requestId ?? null,
        projectName: input.projectName ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      return blocks;
    }
  }
}
