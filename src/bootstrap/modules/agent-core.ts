import path from "node:path";
import type { KaelConfig } from "../../config.js";
import { EdgeRuntime } from "../../edge/runtime.js";
import { resolveKaelHome } from "../../global-config.js";
import { BrowserRuntimeService, type BrowserRuntime } from "../../runtime/browser/index.js";
import { McpBridgeService } from "../../tools/mcp/mcp-bridge-service.js";
import { ShellToolService } from "../../tools/system/shell-tool-service.js";

export type AgentCoreModule = {
  shell: ShellToolService;
  mcp: McpBridgeService;
  edge: EdgeRuntime;
  browser: BrowserRuntime;
};

async function bootstrapShellRuntime(config: KaelConfig): Promise<ShellToolService> {
  const shell = new ShellToolService({
    workspaceRoot: config.shell.workspaceRoot,
    defaultTimeoutMs: config.shell.defaultTimeoutMs,
    noOutputTimeoutMs: config.shell.noOutputTimeoutMs,
    maxTimeoutMs: config.shell.maxTimeoutMs,
    maxOutputChars: config.shell.maxOutputChars,
    approvalWaitMs: config.shell.approvalWaitMs,
    killGraceMs: config.shell.killGraceMs,
    defaultYieldMs: config.shell.defaultYieldMs,
    security: config.shell.security,
    ask: config.shell.ask,
    allowlist: config.shell.allowlist,
    approvalsPath: path.join(resolveKaelHome(), "exec-approvals.json"),
  });
  await shell.init();
  return shell;
}

async function bootstrapMcpRuntime(config: KaelConfig): Promise<McpBridgeService> {
  const mcp = new McpBridgeService({
    enabled: config.mcp.enabled,
    binary: config.mcp.binary,
    configPath: config.mcp.configPath,
    registryPath: path.join(config.dataDir, "mcp", "registry.json"),
    approvalsPath: path.join(config.dataDir, "mcp", "approvals.json"),
    workspaceRoot: config.shell.workspaceRoot,
    defaultTimeoutMs: config.mcp.defaultTimeoutMs,
    maxOutputChars: config.mcp.maxOutputChars,
    allowHttp: config.mcp.allowHttp,
    allowStdio: config.mcp.allowStdio,
  });
  await mcp.init();
  return mcp;
}

function bootstrapBrowserRuntime(config: KaelConfig): BrowserRuntime {
  return new BrowserRuntimeService({
    enabled: config.browser.enabled,
    headless: config.browser.headless,
    defaultTimeoutMs: config.browser.defaultTimeoutMs,
    actionTimeoutMs: config.browser.actionTimeoutMs,
    maxScreenshotsPerTurn: config.browser.maxScreenshotsPerTurn,
    sessionTtlMs: config.browser.sessionTtlMs,
    maxSessions: config.browser.maxSessions,
    artifactDir: config.browser.artifactDir,
  });
}

export async function bootstrapAgentCoreModule(config: KaelConfig): Promise<AgentCoreModule> {
  const shell = await bootstrapShellRuntime(config);
  const mcp = await bootstrapMcpRuntime(config);

  return {
    shell,
    mcp,
    edge: new EdgeRuntime(),
    browser: bootstrapBrowserRuntime(config),
  };
}
