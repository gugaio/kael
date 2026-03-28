import http from 'node:http';

import { McpHttpClient } from '../mcp/http-client.js';

describe('mcp http client', () => {
  it('lists tools and calls a tool over HTTP JSON-RPC', async () => {
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };

      if (body.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'get_session_details',
                description: 'Fetch session details',
              },
            ],
          },
        }));
        return;
      }

      if (body.method === 'tools/call') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            sessionId: body.params.arguments && typeof body.params.arguments === 'object'
              ? (body.params.arguments as { sessionId?: string }).sessionId
              : undefined,
          },
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected address info');
    }

    const client = new McpHttpClient({
      name: 'corp-observability',
      baseUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: 3000,
    });

    const tools = await client.listTools();
    const result = await client.callTool('get_session_details', { sessionId: 'abc123' });

    expect(tools[0]?.name).toBe('get_session_details');
    expect(result).toEqual({ sessionId: 'abc123' });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
