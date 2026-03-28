import http from 'node:http';

import { createInternalHttpFetchCapability } from '../capabilities/internal-http-fetch.js';

describe('internal.http.fetch', () => {
  it('allows requests to approved hosts', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected address info');
    }

    const capability = createInternalHttpFetchCapability({
      allowlist: ['127.0.0.1', 'localhost'],
      timeoutMs: 3000,
      maxBytes: 1024,
    });

    const result = await capability.execute({
      url: `http://127.0.0.1:${address.port}/`,
      method: 'GET',
    }, { signal: new AbortController().signal });

    expect(result.status).toBe(200);
    expect(result.body).toBe('ok');

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects requests to hosts outside the allowlist', async () => {
    const capability = createInternalHttpFetchCapability({
      allowlist: ['localhost'],
      timeoutMs: 3000,
      maxBytes: 1024,
    });

    await expect(capability.execute({
      url: 'http://127.0.0.1:9999/',
      method: 'GET',
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'host_not_allowed',
    });
  });
});
