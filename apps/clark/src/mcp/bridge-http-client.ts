import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { ClarkSettings, McpHttpServerSettings } from '../config/settings.js';
import { ClarkError } from '../utils/errors.js';
import type { McpToolDescriptor } from './types.js';

interface CommandRunnerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
  maxOutputChars: number,
) => Promise<CommandRunnerResult>;

interface McporterListEnvelope {
  mode?: string;
  name?: string;
  status?: string;
  tools?: McpToolDescriptor[];
  issue?: {
    kind?: string;
    rawMessage?: string;
    statusCode?: number;
  };
  error?: string;
}

interface McporterCallFailureEnvelope {
  server?: string;
  tool?: string;
  error?: string;
  issue?: {
    kind?: string;
    rawMessage?: string;
    statusCode?: number;
  };
}

export class McpBridgeHttpClient {
  constructor(
    private readonly server: McpHttpServerSettings,
    private readonly settings: Pick<ClarkSettings, 'mcpBridgeBinary' | 'mcpBridgeConfigPath' | 'mcpBridgeMaxOutputChars'>,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  async listTools(): Promise<McpToolDescriptor[]> {
    const args = ['list'];
    if (this.settings.mcpBridgeConfigPath) {
      args.push('--config', this.settings.mcpBridgeConfigPath);
    }
    args.push(this.server.baseUrl, '--json');

    const result = await this.runner(
      this.settings.mcpBridgeBinary,
      args,
      this.server.timeoutMs,
      this.settings.mcpBridgeMaxOutputChars,
    );

    if (!result.ok) {
      throw buildBridgeFailure(this.server.name, 'list', result);
    }

    return extractListTools(this.server.name, result.stdout);
  }

  async callTool(toolName: string, argsJson: Record<string, unknown>): Promise<unknown> {
    const args = ['call'];
    if (this.settings.mcpBridgeConfigPath) {
      args.push('--config', this.settings.mcpBridgeConfigPath);
    }
    args.push(`${this.server.baseUrl}.${toolName}`, '--args', JSON.stringify(argsJson), '--output', 'json');

    const result = await this.runner(
      this.settings.mcpBridgeBinary,
      args,
      this.server.timeoutMs,
      this.settings.mcpBridgeMaxOutputChars,
    );

    if (!result.ok) {
      throw buildBridgeFailure(this.server.name, 'call', result);
    }

    return parseCallOutput(result.stdout);
  }
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const extracted = extractJsonDocument(trimmed);
    if (!extracted) {
      throw error;
    }
    return JSON.parse(extracted);
  }
}

function extractListTools(serverName: string, stdout: string): McpToolDescriptor[] {
  let parsed: unknown;
  try {
    parsed = parseJson(stdout);
  } catch (error) {
    const recovered = extractToolDescriptorsHeuristically(stdout);
    if (recovered.length > 0) {
      return recovered;
    }
    throw new ClarkError(
      'invalid_mcp_response',
      error instanceof Error ? error.message : `Unexpected mcporter list output for ${serverName}`,
      {
        serverName,
      },
    );
  }

  if (Array.isArray(parsed)) {
    return parsed as McpToolDescriptor[];
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ClarkError('invalid_mcp_response', `Unexpected mcporter list output for ${serverName}`);
  }

  const envelope = parsed as McporterListEnvelope;
  if (Array.isArray(envelope.tools)) {
    if (envelope.status && envelope.status !== 'ok') {
      throw new ClarkError(
        'mcp_bridge_error',
        extractEnvelopeMessage(envelope) ?? `mcporter list reported status ${envelope.status} for ${serverName}`,
        {
          serverName,
          status: envelope.status,
          issue: envelope.issue,
          error: envelope.error,
        },
      );
    }
    return envelope.tools;
  }

  if (envelope.status && envelope.status !== 'ok') {
    throw new ClarkError(
      'mcp_bridge_error',
      extractEnvelopeMessage(envelope) ?? `mcporter list reported status ${envelope.status} for ${serverName}`,
      {
        serverName,
        status: envelope.status,
        issue: envelope.issue,
        error: envelope.error,
      },
    );
  }

  throw new ClarkError('invalid_mcp_response', `mcporter list did not return tools for ${serverName}`);
}

function parseCallOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return parseJson(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function buildBridgeFailure(
  serverName: string,
  action: 'list' | 'call',
  result: CommandRunnerResult,
): ClarkError {
  const parsedStdout = tryParseJson(result.stdout);
  const parsedStderr = tryParseJson(result.stderr);
  const parsed = parsedStdout ?? parsedStderr;

  return new ClarkError(
    'mcp_bridge_error',
    extractEnvelopeMessage(parsed)
      ?? result.error
      ?? result.stderr.trim()
      ?? result.stdout.trim()
      ?? `mcporter ${action} exited with code ${result.exitCode ?? 'unknown'}`,
    {
      serverName,
      action,
      exitCode: result.exitCode,
      issue: extractEnvelopeIssue(parsed),
      error: extractEnvelopeError(parsed),
    },
  );
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return parseJson(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractJsonDocument(raw: string): string | null {
  const start = findFirstJsonStart(raw);
  if (start < 0) {
    return null;
  }

  const opener = raw[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opener) {
      depth += 1;
      continue;
    }

    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function findFirstJsonStart(raw: string): number {
  const objectIndex = raw.indexOf('{');
  const arrayIndex = raw.indexOf('[');

  if (objectIndex === -1) {
    return arrayIndex;
  }
  if (arrayIndex === -1) {
    return objectIndex;
  }

  return Math.min(objectIndex, arrayIndex);
}

function extractToolDescriptorsHeuristically(raw: string): McpToolDescriptor[] {
  const toolsIndex = raw.indexOf('"tools"');
  if (toolsIndex < 0) {
    return [];
  }

  const relevant = raw.slice(toolsIndex);
  const descriptors: McpToolDescriptor[] = [];
  const seen = new Set<string>();
  const namePattern = /"name"\s*:\s*"((?:\\.|[^"\\])+)"/g;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(relevant)) !== null) {
    const encodedName = match[1];
    if (!encodedName) {
      continue;
    }

    let name = encodedName;
    try {
      name = JSON.parse(`"${encodedName}"`) as string;
    } catch {
      name = encodedName;
    }

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    descriptors.push({ name });
  }

  return descriptors;
}

function extractEnvelopeMessage(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const issue = extractEnvelopeIssue(input);
  if (issue?.rawMessage) {
    return issue.rawMessage;
  }

  const error = extractEnvelopeError(input);
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  const message = (input as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  return undefined;
}

function extractEnvelopeIssue(
  input: unknown,
): McporterListEnvelope['issue'] | McporterCallFailureEnvelope['issue'] | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const issue = (input as { issue?: unknown }).issue;
  if (!issue || typeof issue !== 'object') {
    return undefined;
  }

  return issue as McporterListEnvelope['issue'];
}

function extractEnvelopeError(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const error = (input as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  maxOutputChars: number,
): Promise<CommandRunnerResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clark-mcp-'));
  const stdoutPath = path.join(tempDir, 'stdout.log');
  const stderrPath = path.join(tempDir, 'stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let stdoutClosed = false;
  let stderrClosed = false;

  try {
    return await new Promise((resolve) => {
      let timedOut = false;
      let spawnError: Error | undefined;
      const child = spawn(command, args, {
        stdio: ['ignore', stdoutFd, stderrFd],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.once('error', (error) => {
        spawnError = error;
      });

      child.once('close', async (code) => {
        clearTimeout(timer);
        closeFd(stdoutFd, () => {
          stdoutClosed = true;
        });
        closeFd(stderrFd, () => {
          stderrClosed = true;
        });

        const [stdout, stderr] = await Promise.all([
          safeReadText(stdoutPath, maxOutputChars),
          safeReadText(stderrPath, maxOutputChars),
        ]);

        if (spawnError) {
          const spawnErrorCode =
            typeof (spawnError as unknown as { code?: unknown }).code === 'number'
              ? (spawnError as unknown as { code: number }).code
              : code;
          resolve({
            ok: false,
            stdout,
            stderr,
            exitCode: spawnErrorCode,
            error: spawnError.message,
          });
          return;
        }

        if (timedOut) {
          resolve({
            ok: false,
            stdout,
            stderr,
            exitCode: code,
            error: `mcporter timed out after ${timeoutMs}ms`,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            ok: false,
            stdout,
            stderr,
            exitCode: code,
            error: stderr.trim() || stdout.trim() || `mcporter exited with code ${code ?? 'unknown'}`,
          });
          return;
        }

        resolve({
          ok: true,
          stdout,
          stderr,
          exitCode: code,
        });
      });
    });
  } finally {
    if (!stdoutClosed) {
      closeFd(stdoutFd, () => {
        stdoutClosed = true;
      });
    }
    if (!stderrClosed) {
      closeFd(stderrFd, () => {
        stderrClosed = true;
      });
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function safeReadText(filePath: string, maxChars: number): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (raw.length <= maxChars) {
      return raw;
    }
    return raw.slice(raw.length - maxChars);
  } catch {
    return '';
  }
}

function closeFd(fd: number, onClosed: () => void): void {
  try {
    fs.closeSync(fd);
    onClosed();
  } catch {}
}
