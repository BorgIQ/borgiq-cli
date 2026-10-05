import { afterEach, describe, expect, it, vi } from 'vitest';

import { BorgIQClient } from '../../src/client/index.js';

const RESULT_ID = 'FRJR01result0000000000000000';

const client = new BorgIQClient('https://api.test', 'token');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJobResultData', () => {
  it.each(['memory', 'messages'] as const)('asks for the %s root of the result', async (rootPath) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.getJobResultData('o', 'w', RESULT_ID, rootPath)).resolves.toEqual({ ok: true });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe(`/orgs/o/workspaces/w/flowrunJobResults/${RESULT_ID}/data`);
    expect([...url.searchParams]).toEqual([['rootPath', rootPath]]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });
});
