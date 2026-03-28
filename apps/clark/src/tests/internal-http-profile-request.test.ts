import http from 'node:http';

import { createInternalHttpProfileRequestCapability } from '../capabilities/internal-http-profile-request.js';

describe('internal.http.profile_request', () => {
  it('injects profile headers and builds URL from relative path', async () => {
    let seenToken: string | undefined;

    const server = http.createServer((req, res) => {
      seenToken = req.headers['x-api-token'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected address info');
    }

    const capability = createInternalHttpProfileRequestCapability({
      profiles: [
        {
          name: 'traceview',
          baseUrl: `http://127.0.0.1:${address.port}`,
          allowedMethods: ['GET'],
          timeoutMs: 3000,
          maxBytes: 4096,
          defaultHeaders: {
            'x-api-token': 'secret-token',
          },
        },
      ],
    });

    const result = await capability.execute({
      profile: 'traceview',
      path: '/sessions/abc123',
      query: { includeMetrics: true },
      method: 'GET',
    }, { signal: new AbortController().signal });

    expect(seenToken).toBe('secret-token');
    expect(result.profile).toBe('traceview');
    expect(result.url).toContain('/sessions/abc123');
    expect(result.url).toContain('includeMetrics=true');

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('fails for unknown profiles', async () => {
    const capability = createInternalHttpProfileRequestCapability({
      profiles: [],
    });

    await expect(capability.execute({
      profile: 'missing',
      path: '/sessions/abc123',
      method: 'GET',
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'unknown_http_profile',
    });
  });
});
