import { execFile } from 'node:child_process';

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
    args.push(this.server.baseUrl, '--output', 'json');

    const result = await this.runner(
      this.settings.mcpBridgeBinary,
      args,
      this.server.timeoutMs,
      this.settings.mcpBridgeMaxOutputChars,
    );

    if (!result.ok) {
      throw new ClarkError(
        'mcp_bridge_error',
        result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? 'unknown'}`,
      );
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) {
      throw new ClarkError('invalid_mcp_response', 'Expected array output from mcporter list');
    }

    return parsed as McpToolDescriptor[];
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
      throw new ClarkError(
        'mcp_bridge_error',
        result.error || result.stderr.trim() || `mcporter exited with code ${result.exitCode ?? 'unknown'}`,
      );
    }

    return JSON.parse(result.stdout) as unknown;
  }
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  maxOutputChars: number,
): Promise<CommandRunnerResult> {
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: timeoutMs,
      maxBuffer: maxOutputChars,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null,
          error: error.message,
        });
        return;
      }

      resolve({
        ok: true,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: 0,
      });
    });
  });
}
