import { McpBridgeHttpClient } from '../mcp/bridge-http-client.js';

describe('mcp bridge http client', () => {
  it('uses mcporter to list tools and call a tool', async () => {
    const seen: Array<{ command: string; args: string[] }> = [];
    const client = new McpBridgeHttpClient(
      {
        name: 'youbora',
        kind: 'mcp-http-bridge',
        baseUrl: 'https://youbora.example.com/mcp',
        timeoutMs: 3000,
      },
      {
        mcpBridgeBinary: 'mcporter',
        mcpBridgeConfigPath: '/tmp/mcporter.json',
        mcpBridgeMaxOutputChars: 10000,
      },
      async (command, args) => {
        seen.push({ command, args });
        if (args[0] === 'list') {
          return {
            ok: true,
            stdout: '{"mode":"server","status":"ok","tools":[{"name":"get_session_details"}]}',
            stderr: '',
            exitCode: 0,
          };
        }

        return {
          ok: true,
          stdout: '{"sessionId":"abc123"}',
          stderr: '',
          exitCode: 0,
        };
      },
    );

    const tools = await client.listTools();
    const output = await client.callTool('get_session_details', { sessionId: 'abc123' });

    expect(tools[0]?.name).toBe('get_session_details');
    expect(output).toEqual({ sessionId: 'abc123' });
    expect(seen).toEqual([
      {
        command: 'mcporter',
        args: [
          'list',
          '--config',
          '/tmp/mcporter.json',
          'https://youbora.example.com/mcp',
          '--json',
        ],
      },
      {
        command: 'mcporter',
        args: [
          'call',
          '--config',
          '/tmp/mcporter.json',
          'https://youbora.example.com/mcp.get_session_details',
          '--args',
          '{"sessionId":"abc123"}',
          '--output',
          'json',
        ],
      },
    ]);
  });

  it('surfaces mcporter SSE/offline errors from list output', async () => {
    const client = new McpBridgeHttpClient(
      {
        name: 'youbora',
        kind: 'mcp-http-bridge',
        baseUrl: 'https://youbora.example.com/mcp',
        timeoutMs: 3000,
      },
      {
        mcpBridgeBinary: 'mcporter',
        mcpBridgeConfigPath: undefined,
        mcpBridgeMaxOutputChars: 10000,
      },
      async () => ({
        ok: true,
        stdout: JSON.stringify({
          mode: 'server',
          status: 'offline',
          issue: {
            kind: 'offline',
            rawMessage: 'SSE error: TypeError: fetch failed',
          },
          error: 'offline',
        }),
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(client.listTools()).rejects.toMatchObject({
      code: 'mcp_bridge_error',
      message: 'SSE error: TypeError: fetch failed',
    });
  });

  it('extracts JSON payloads even when mcporter prints warnings around them', async () => {
    const client = new McpBridgeHttpClient(
      {
        name: 'youbora',
        kind: 'mcp-http-bridge',
        baseUrl: 'https://youbora.example.com/mcp',
        timeoutMs: 3000,
      },
      {
        mcpBridgeBinary: 'mcporter',
        mcpBridgeConfigPath: undefined,
        mcpBridgeMaxOutputChars: 10000,
      },
      async () => ({
        ok: true,
        stdout: [
          '(node:12345) ExperimentalWarning: test warning',
          '{"mode":"server","status":"ok","tools":[{"name":"get_metrics"}]}',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(client.listTools()).resolves.toEqual([{ name: 'get_metrics' }]);
  });

  it('recovers tool names from malformed JSON output', async () => {
    const client = new McpBridgeHttpClient(
      {
        name: 'youbora',
        kind: 'mcp-http-bridge',
        baseUrl: 'https://youbora.example.com/mcp',
        timeoutMs: 3000,
      },
      {
        mcpBridgeBinary: 'mcporter',
        mcpBridgeConfigPath: undefined,
        mcpBridgeMaxOutputChars: 10000,
      },
      async () => ({
        ok: true,
        stdout:
          '{"mode":"server","status":"ok","tools":[{"name":"get_filter_help"},{"name":"get_metrics"},{"name":"get_rawdata"}],"broken":"unterminated',
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(client.listTools()).resolves.toEqual([
      { name: 'get_filter_help' },
      { name: 'get_metrics' },
      { name: 'get_rawdata' },
    ]);
  });
});
