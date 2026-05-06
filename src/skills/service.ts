import fs from "node:fs/promises";
import path from "node:path";
import { isSlashCommand } from "../agents/simple-engine.js";

const DEFAULT_SKILLS_RELATIVE_DIR = path.join(".kael", "skills");
const SKILL_ENTRY_FILE = "SKILL.md";
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_DESCRIPTION = "Skill local do workspace.";
const SKILLS_CATALOG_MAX_CHARS = 4000;
const AUTO_SKILL_MIN_SCORE = 2;
const AUTO_SKILL_MAX_PER_TURN = 1;
const AUTO_SKILL_MIN_MESSAGE_TOKENS = 2;
const AUTO_SKILL_STOPWORDS = new Set([
  "por",
  "para",
  "com",
  "sem",
  "isso",
  "isto",
  "essa",
  "esse",
  "aqui",
  "ali",
  "ainda",
  "depois",
  "antes",
  "pode",
  "podemos",
  "quero",
  "queria",
  "faz",
  "fazer",
  "ajuda",
  "ajudar",
  "analisa",
  "analisar",
  "coisa",
  "algo",
  "sobre",
  "mim",
  "pra",
  "que",
  "como",
  "quando",
]);

const RESERVED_OPERATIONAL_COMMANDS = new Set([
  "/help",
  "/jobs",
  "/transcode",
  "/hls",
  "/capture",
  "/probe",
  "/vlc",
  "/playvlc",
  "/browser-start",
  "/browser-open",
  "/browser-navigate",
  "/browser-snapshot",
  "/browser-shot",
  "/browser-screenshot",
  "/browser-click",
  "/browser-type",
  "/browser-press",
  "/browser-wait",
  "/browser-close",
  "/compact",
]);

type SkillFrontmatter = {
  name?: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
};

type SkillEntry = {
  name: string;
  description: string;
  argumentHint?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  content: string;
  filePath: string;
};

type SkillSnapshot = {
  byName: Map<string, SkillEntry>;
  discoveredAt: string;
};

type SkillTelemetry = {
  enabled: boolean;
  skillsDir: string;
  skillsDiscovered: number;
  manualInvocations: number;
  autoInvocations: number;
  invocationBlocked: number;
  autoDecisionCounts: Record<SkillAutoDecisionReason, number>;
  lastAutoDecision: {
    at: string | null;
    reason: SkillAutoDecisionReason | null;
    skillName: string | null;
  };
  sessionAuto: {
    trackedSessions: number;
    sessionsWithSelection: number;
  };
  lastError: string | null;
};

type ParseFrontmatterResult = {
  frontmatter: Record<string, string | boolean | string[]>;
  body: string;
};

export type SkillsRuntimeTelemetry = SkillTelemetry;

export type SkillManualInvocationResult =
  | {
      matched: false;
    }
  | {
      matched: true;
      blocked: true;
      skillName: string;
      reply: string;
    }
  | {
      matched: true;
      blocked: false;
      skillName: string;
      promptMessage: string;
    };

export type SkillTurnPreparationResult = {
  promptMessage: string;
  autoAppliedSkillName: string | null;
};

type SkillAutoDecisionReason =
  | "selected"
  | "slash_message"
  | "no_discovered_skills"
  | "no_auto_invocable_skills"
  | "generic_message"
  | "below_threshold"
  | "auto_disabled";

type SkillSessionAutoStats = {
  attempts: number;
  selections: number;
  lastDecisionAt: string;
  lastDecisionReason: SkillAutoDecisionReason;
  lastSkillName: string | null;
};

export type SkillServiceOptions = {
  catalogMaxChars?: number;
  autoSkillMinScore?: number;
  autoSkillMaxPerTurn?: number;
  sessionStatsLimit?: number;
};

function normalizeSkillName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!SKILL_NAME_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function parseSlashNameAndArgs(message: string): { name: string; args: string[] } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  const [nameRaw, ...args] = parts;
  const normalizedName = normalizeSkillName(nameRaw.slice(1));
  if (!normalizedName) {
    return null;
  }
  return {
    name: normalizedName,
    args,
  };
}

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlBooleanOrString(raw: string): string | boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return stripQuotes(raw);
}

function parseFrontmatter(raw: string): ParseFrontmatterResult {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      frontmatter: {},
      body: normalized,
    };
  }
  const endIdx = normalized.indexOf("\n---\n", 4);
  if (endIdx < 0) {
    return {
      frontmatter: {},
      body: normalized,
    };
  }
  const frontmatterRaw = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5);
  const frontmatter: Record<string, string | boolean | string[]> = {};
  const lines = frontmatterRaw.split("\n");

  let idx = 0;
  while (idx < lines.length) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      idx += 1;
      continue;
    }
    const match = rawLine.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      idx += 1;
      continue;
    }
    const key = match[1]?.trim().toLowerCase();
    const valueRaw = (match[2] ?? "").trim();
    if (!key) {
      idx += 1;
      continue;
    }

    if (valueRaw === "|" || valueRaw === ">") {
      const blockStyle = valueRaw;
      const blockLines: string[] = [];
      idx += 1;
      while (idx < lines.length) {
        const line = lines[idx];
        if (/^\s*$/.test(line)) {
          blockLines.push("");
          idx += 1;
          continue;
        }
        if (!/^\s+/.test(line)) {
          break;
        }
        blockLines.push(line.replace(/^\s+/, ""));
        idx += 1;
      }
      frontmatter[key] =
        blockStyle === ">"
          ? blockLines.map((line) => line.trim()).filter(Boolean).join(" ")
          : blockLines.join("\n").trim();
      continue;
    }

    if (valueRaw.length === 0) {
      const items: string[] = [];
      idx += 1;
      while (idx < lines.length) {
        const line = lines[idx];
        const listMatch = line.match(/^\s*-\s+(.*)$/);
        if (!listMatch) {
          break;
        }
        items.push(stripQuotes(listMatch[1] ?? "").trim());
        idx += 1;
      }
      if (items.length > 0) {
        frontmatter[key] = items;
      }
      continue;
    }

    frontmatter[key] = parseYamlBooleanOrString(valueRaw);
    idx += 1;
  }
  return { frontmatter, body };
}

function pickFirstParagraph(markdownBody: string): string {
  const lines = markdownBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return DEFAULT_DESCRIPTION;
  }
  const paragraphLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("- ") || /^\d+\./.test(line)) {
      break;
    }
    paragraphLines.push(line);
    if (paragraphLines.length >= 3) {
      break;
    }
  }
  const paragraph = paragraphLines.join(" ").trim();
  return paragraph || DEFAULT_DESCRIPTION;
}

function pickStringValue(value: string | boolean | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(" ").trim() || undefined;
  }
  return undefined;
}

function toFrontmatterModel(frontmatter: Record<string, string | boolean | string[]>): SkillFrontmatter {
  const name = pickStringValue(frontmatter.name);
  const description = pickStringValue(frontmatter.description);
  const argumentHint =
    pickStringValue(frontmatter["argument-hint"]);
  return {
    name,
    description,
    argumentHint,
    disableModelInvocation:
      typeof frontmatter["disable-model-invocation"] === "boolean"
        ? frontmatter["disable-model-invocation"]
        : false,
    userInvocable:
      typeof frontmatter["user-invocable"] === "boolean" ? frontmatter["user-invocable"] : true,
  };
}

function replaceArguments(content: string, args: string[]): string {
  const argsJoined = args.join(" ").trim();
  const replacedIndexed = content
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_full, indexRaw: string) => {
      const index = Number(indexRaw);
      if (!Number.isFinite(index) || index < 0) {
        return "";
      }
      return args[index] ?? "";
    })
    .replace(/\$(\d+)/g, (_full, indexRaw: string) => {
      const index = Number(indexRaw);
      if (!Number.isFinite(index) || index < 0) {
        return "";
      }
      return args[index] ?? "";
    });
  if (replacedIndexed.includes("$ARGUMENTS")) {
    return replacedIndexed.replace(/\$ARGUMENTS/g, argsJoined);
  }
  if (!argsJoined) {
    return replacedIndexed;
  }
  return `${replacedIndexed.trimEnd()}\n\nARGUMENTS: ${argsJoined}`;
}

function tokenize(input: string): string[] {
  return (input.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []).filter(Boolean);
}

type MessageTokenAnalysis = {
  tokenSet: Set<string>;
  tokenList: string[];
  nonGenericCount: number;
  isGeneric: boolean;
};

function analyzeMessageTokens(message: string): MessageTokenAnalysis {
  const tokenList = tokenize(message);
  const tokenSet = new Set(tokenList);
  const nonGenericCount = tokenList.filter((token) => !AUTO_SKILL_STOPWORDS.has(token)).length;
  return {
    tokenSet,
    tokenList,
    nonGenericCount,
    isGeneric: tokenSet.size < AUTO_SKILL_MIN_MESSAGE_TOKENS || nonGenericCount === 0,
  };
}

function scoreSkillRelevanceFromAnalysis(analysis: MessageTokenAnalysis, message: string, skill: SkillEntry): number {
  const messageTokens = analysis.tokenSet;
  if (analysis.isGeneric) {
    return 0;
  }
  const skillTokens = new Set([...tokenize(skill.name), ...tokenize(skill.description)]);
  if (skillTokens.size === 0) {
    return 0;
  }
  let score = 0;
  let overlap = 0;
  const messageTokenList = analysis.tokenList;
  for (const token of skillTokens) {
    const exactMatch = messageTokens.has(token);
    const prefixMatch =
      !exactMatch &&
      messageTokenList.some((msgToken) => {
        if (msgToken.length < 4 || token.length < 4) {
          return false;
        }
        return msgToken.startsWith(token) || token.startsWith(msgToken);
      });
    if (exactMatch || prefixMatch) {
      overlap += 1;
    }
  }
  score += overlap;
  const nameMatched = message.toLowerCase().includes(skill.name.toLowerCase());
  if (nameMatched) {
    score += 2;
  }
  const overlapCoverage = overlap / Math.max(1, Math.min(4, skillTokens.size));
  if (overlapCoverage >= 0.5) {
    score += 1;
  }
  const genericRatio = 1 - analysis.nonGenericCount / Math.max(1, messageTokens.size);
  if (genericRatio > 0.7 && !nameMatched) {
    score = Math.max(0, score - 1);
  }
  return score;
}

function renderCatalog(skills: SkillEntry[], maxChars: number): string {
  if (skills.length === 0) {
    return "";
  }
  const lines: string[] = [
    "[available_skills]",
    "Antes de responder: considere as skills abaixo. Use no maximo uma skill automaticamente por turno.",
  ];
  let usedChars = lines.join("\n").length;
  for (const skill of skills) {
    const hint = skill.argumentHint ? ` | argumentHint: ${skill.argumentHint}` : "";
    const line = `- name: ${skill.name} | description: ${skill.description}${hint}`;
    if (usedChars + line.length > maxChars) {
      break;
    }
    lines.push(line);
    usedChars += line.length;
  }
  lines.push("[/available_skills]");
  return lines.join("\n");
}

type SkillServiceDeps = {
  readdir: (
    path: string,
    options: { withFileTypes: true; encoding: "utf8" },
  ) => Promise<Array<{ name: string; isDirectory(): boolean }>>;
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
};

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? "");
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? "");
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function resolvePositiveIntOption(
  explicit: number | undefined,
  envRaw: string | undefined,
  fallback: number,
): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveInt(envRaw, fallback);
}

function resolveNonNegativeIntOption(
  explicit: number | undefined,
  envRaw: string | undefined,
  fallback: number,
): number {
  if (explicit != null && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  return readNonNegativeInt(envRaw, fallback);
}

export class SkillService {
  private readonly skillsDir: string;
  private readonly telemetry: SkillTelemetry;
  private readonly deps: SkillServiceDeps;
  private snapshot: SkillSnapshot = {
    byName: new Map(),
    discoveredAt: new Date(0).toISOString(),
  };
  private readonly catalogMaxChars: number;
  private readonly autoSkillMinScore: number;
  private readonly autoSkillMaxPerTurn: number;
  private readonly sessionStatsLimit: number;
  private readonly sessionAutoStats = new Map<string, SkillSessionAutoStats>();

  constructor(
    private readonly workspaceRoot: string,
    deps?: Partial<SkillServiceDeps>,
    options?: SkillServiceOptions,
  ) {
    this.skillsDir = path.join(this.workspaceRoot, DEFAULT_SKILLS_RELATIVE_DIR);
    this.telemetry = {
      enabled: true,
      skillsDir: this.skillsDir,
      skillsDiscovered: 0,
      manualInvocations: 0,
      autoInvocations: 0,
      invocationBlocked: 0,
      autoDecisionCounts: {
        selected: 0,
        slash_message: 0,
        no_discovered_skills: 0,
        no_auto_invocable_skills: 0,
        generic_message: 0,
        below_threshold: 0,
        auto_disabled: 0,
      },
      lastAutoDecision: {
        at: null,
        reason: null,
        skillName: null,
      },
      sessionAuto: {
        trackedSessions: 0,
        sessionsWithSelection: 0,
      },
      lastError: null,
    };
    this.deps = {
      readdir: deps?.readdir ?? fs.readdir,
      readFile: deps?.readFile ?? fs.readFile,
    };
    this.catalogMaxChars = resolvePositiveIntOption(
      options?.catalogMaxChars,
      process.env.KAEL_SKILLS_CATALOG_MAX_CHARS,
      SKILLS_CATALOG_MAX_CHARS,
    );
    this.autoSkillMinScore = resolvePositiveIntOption(
      options?.autoSkillMinScore,
      process.env.KAEL_SKILLS_AUTO_MIN_SCORE,
      AUTO_SKILL_MIN_SCORE,
    );
    this.autoSkillMaxPerTurn = resolveNonNegativeIntOption(
      options?.autoSkillMaxPerTurn,
      process.env.KAEL_SKILLS_AUTO_MAX_PER_TURN,
      AUTO_SKILL_MAX_PER_TURN,
    );
    this.sessionStatsLimit = resolvePositiveIntOption(
      options?.sessionStatsLimit,
      process.env.KAEL_SKILLS_SESSION_STATS_LIMIT,
      100,
    );
  }

  getRuntimeTelemetrySnapshot(): SkillsRuntimeTelemetry {
    return { ...this.telemetry };
  }

  async resolveManualInvocation(message: string): Promise<SkillManualInvocationResult> {
    if (!isSlashCommand(message)) {
      return { matched: false };
    }
    const parsed = parseSlashNameAndArgs(message);
    if (!parsed) {
      return { matched: false };
    }
    const slashName = `/${parsed.name}`;
    if (RESERVED_OPERATIONAL_COMMANDS.has(slashName)) {
      return { matched: false };
    }
    const snapshot = await this.discover();
    const skill = snapshot.byName.get(parsed.name);
    if (!skill) {
      return { matched: false };
    }
    if (!skill.userInvocable) {
      this.telemetry.invocationBlocked += 1;
      return {
        matched: true,
        blocked: true,
        skillName: skill.name,
        reply: `A skill /${skill.name} nao pode ser invocada manualmente (user-invocable=false).`,
      };
    }

    this.telemetry.manualInvocations += 1;
    const renderedContent = replaceArguments(skill.content, parsed.args);
    const promptMessage = [
      "[skill_invocation]",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `source: ${skill.filePath}`,
      "[/skill_invocation]",
      "",
      "[skill_instructions]",
      renderedContent,
      "[/skill_instructions]",
      "",
      "[user_request]",
      parsed.args.length > 0 ? parsed.args.join(" ") : message.trim(),
      "[/user_request]",
    ].join("\n");

    return {
      matched: true,
      blocked: false,
      skillName: skill.name,
      promptMessage,
    };
  }

  async prepareTurnMessage(
    message: string,
    context?: { sessionKey?: string },
  ): Promise<SkillTurnPreparationResult> {
    const sessionKey = context?.sessionKey?.trim() || undefined;
    const snapshot = await this.discover();
    if (snapshot.byName.size === 0) {
      this.recordAutoDecision("no_discovered_skills", sessionKey, null);
      return {
        promptMessage: message,
        autoAppliedSkillName: null,
      };
    }

    const autoInvocableSkills = [...snapshot.byName.values()].filter(
      (skill) => !skill.disableModelInvocation,
    );
    const catalog = renderCatalog(autoInvocableSkills, this.catalogMaxChars);
    if (isSlashCommand(message)) {
      this.recordAutoDecision("slash_message", sessionKey, null);
      return {
        promptMessage: message,
        autoAppliedSkillName: null,
      };
    }
    if (catalog.length === 0) {
      this.recordAutoDecision("no_auto_invocable_skills", sessionKey, null);
      return {
        promptMessage: message,
        autoAppliedSkillName: null,
      };
    }
    if (this.autoSkillMaxPerTurn <= 0) {
      this.recordAutoDecision("auto_disabled", sessionKey, null);
      return {
        promptMessage: [catalog, "", "[user_request]", message, "[/user_request]"].join("\n"),
        autoAppliedSkillName: null,
      };
    }

    const messageAnalysis = analyzeMessageTokens(message);
    if (messageAnalysis.isGeneric) {
      this.recordAutoDecision("generic_message", sessionKey, null);
      return {
        promptMessage: [catalog, "", "[user_request]", message, "[/user_request]"].join("\n"),
        autoAppliedSkillName: null,
      };
    }

    let bestSkill: SkillEntry | null = null;
    let bestScore = 0;
    for (const skill of autoInvocableSkills) {
      const score = scoreSkillRelevanceFromAnalysis(messageAnalysis, message, skill);
      if (score > bestScore) {
        bestScore = score;
        bestSkill = skill;
      }
    }

    let autoAppliedSkillName: string | null = null;
    const blocks = [catalog];
    if (bestSkill && bestScore >= this.autoSkillMinScore) {
      autoAppliedSkillName = bestSkill.name;
      this.telemetry.autoInvocations += 1;
      this.recordAutoDecision("selected", sessionKey, bestSkill.name);
      blocks.push(
        [
          "",
          "[auto_skill_selected]",
          `name: ${bestSkill.name}`,
          `description: ${bestSkill.description}`,
          `source: ${bestSkill.filePath}`,
          "[/auto_skill_selected]",
          "",
          "[skill_instructions]",
          bestSkill.content,
          "[/skill_instructions]",
        ].join("\n"),
      );
    } else {
      this.recordAutoDecision("below_threshold", sessionKey, null);
    }

    blocks.push("", "[user_request]", message, "[/user_request]");

    return {
      promptMessage: blocks.join("\n"),
      autoAppliedSkillName,
    };
  }

  private async discover(): Promise<SkillSnapshot> {
    let dirEntries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      dirEntries = await this.deps.readdir(this.skillsDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        this.snapshot = {
          byName: new Map(),
          discoveredAt: new Date().toISOString(),
        };
        this.telemetry.skillsDiscovered = 0;
        this.telemetry.lastError = null;
        return this.snapshot;
      }
      this.telemetry.lastError = nodeErr.message;
      return this.snapshot;
    }

    const directories = dirEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const byName = new Map<string, SkillEntry>();
    let lastError: string | null = null;
    for (const directory of directories) {
      const filePath = path.join(this.skillsDir, directory, SKILL_ENTRY_FILE);
      let raw: string;
      try {
        raw = await this.deps.readFile(filePath, "utf-8");
      } catch (error) {
        const nodeErr = error as NodeJS.ErrnoException;
        if (nodeErr.code === "ENOENT") {
          continue;
        }
        lastError = nodeErr.message;
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(raw);
      const model = toFrontmatterModel(frontmatter);
      const normalizedName = normalizeSkillName(model.name ?? directory);
      if (!normalizedName) {
        lastError = `Skill invalida em ${filePath}: nome deve usar [a-z0-9-]`;
        continue;
      }
      if (byName.has(normalizedName)) {
        lastError = `Conflito de skill: nome duplicado "${normalizedName}" em ${filePath}`;
        continue;
      }
      const description = (model.description?.trim() || pickFirstParagraph(body)).trim() || DEFAULT_DESCRIPTION;
      byName.set(normalizedName, {
        name: normalizedName,
        description,
        argumentHint: model.argumentHint?.trim() || undefined,
        disableModelInvocation: model.disableModelInvocation,
        userInvocable: model.userInvocable,
        content: body.trim(),
        filePath,
      });
    }

    this.snapshot = {
      byName,
      discoveredAt: new Date().toISOString(),
    };
    this.telemetry.skillsDiscovered = byName.size;
    this.telemetry.lastError = lastError;
    return this.snapshot;
  }

  private recordAutoDecision(
    reason: SkillAutoDecisionReason,
    sessionKey: string | undefined,
    skillName: string | null,
  ): void {
    this.telemetry.autoDecisionCounts[reason] += 1;
    this.telemetry.lastAutoDecision = {
      at: new Date().toISOString(),
      reason,
      skillName,
    };
    if (!sessionKey) {
      return;
    }

    const current = this.sessionAutoStats.get(sessionKey);
    const updated: SkillSessionAutoStats = {
      attempts: (current?.attempts ?? 0) + 1,
      selections: (current?.selections ?? 0) + (reason === "selected" ? 1 : 0),
      lastDecisionAt: this.telemetry.lastAutoDecision.at ?? new Date().toISOString(),
      lastDecisionReason: reason,
      lastSkillName: skillName,
    };
    this.sessionAutoStats.set(sessionKey, updated);

    if (this.sessionAutoStats.size > this.sessionStatsLimit) {
      const oldestKey = this.sessionAutoStats.keys().next().value as string | undefined;
      if (oldestKey) {
        this.sessionAutoStats.delete(oldestKey);
      }
    }
    this.telemetry.sessionAuto = {
      trackedSessions: this.sessionAutoStats.size,
      sessionsWithSelection: [...this.sessionAutoStats.values()].filter((item) => item.selections > 0).length,
    };
  }
}
