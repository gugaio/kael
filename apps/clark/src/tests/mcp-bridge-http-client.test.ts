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
            stdout: '[{"name":"get_session_details"}]',
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
          '--output',
          'json',
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
});
