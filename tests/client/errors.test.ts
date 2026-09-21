import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/client/errors.js';
import { BorgIQClient } from '../../src/client/index.js';

const ACTOR_ID = 'ACTR01reactapp000000000000000';
const REFUSAL = 'Thumbnail must be a PNG, JPEG, WebP, or GIF image.';

const stubFetch = (body: string, init: ResponseInit = { status: 400, statusText: 'Bad Request' }) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const client = new BorgIQClient('https://api.test', 'token');

/** The ApiError a refused actor write rejects with. */
const refusal = async (body: string): Promise<ApiError> => {
  stubFetch(body);
  const error = await client.updateCanvasActor('o', 'w', 'cnv', ACTOR_ID, { thumbnail: null }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API error bodies', () => {
  it('keeps the warnings as details when the API also sends a message', async () => {
    const error = await refusal(JSON.stringify({ message: 'Actor update refused', warnings: [{ actorId: ACTOR_ID, field: 'thumbnail', message: REFUSAL }] }));
    expect(error.message).toBe('Actor update refused');
    expect(error.details).toEqual([{ path: [ACTOR_ID, 'thumbnail'], message: REFUSAL }]);
  });
});
