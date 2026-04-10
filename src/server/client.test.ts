import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerHealth, isServerRunning, queryServer } from './client.js';

describe('server client', () => {
  let originalServerUrl: string | undefined;
  let originalServerAuthToken: string | undefined;

  beforeEach(() => {
    originalServerUrl = process.env['LGREP_SERVER_URL'];
    originalServerAuthToken = process.env['LGREP_SERVER_AUTH_TOKEN'];
    process.env['LGREP_SERVER_URL'] = 'https://lgrep.example.com';
    process.env['LGREP_SERVER_AUTH_TOKEN'] = 'secret-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    if (originalServerUrl === undefined) {
      delete process.env['LGREP_SERVER_URL'];
    } else {
      process.env['LGREP_SERVER_URL'] = originalServerUrl;
    }

    if (originalServerAuthToken === undefined) {
      delete process.env['LGREP_SERVER_AUTH_TOKEN'];
    } else {
      process.env['LGREP_SERVER_AUTH_TOKEN'] = originalServerAuthToken;
    }
  });

  it('adds the bearer token when querying the hosted server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await queryServer({
      method: 'search',
      project: 'demo',
      params: { query: 'auth flow' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://lgrep.example.com/query',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('treats a 401 health response as proof the server is running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }));

    await expect(isServerRunning()).resolves.toBe(true);
  });

  it('throws the server error payload when health is unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }));

    await expect(getServerHealth()).rejects.toThrow('Unauthorized');
  });
});
