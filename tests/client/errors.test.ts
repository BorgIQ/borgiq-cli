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
  it('surfaces an actor-write warning as the message and as a detail naming the actor and field', async () => {
    const error = await refusal(JSON.stringify({ warnings: [{ actorId: ACTOR_ID, field: 'thumbnail', message: REFUSAL }] }));
    expect(error.status).toBe(400);
    expect(error.message).toBe(REFUSAL);
    expect(error.details[0]).toEqual({ path: [ACTOR_ID, 'thumbnail'], message: REFUSAL });
  });

  it('drops warnings that carry no message', async () => {
    const error = await refusal(JSON.stringify({ warnings: [{ actorId: ACTOR_ID, field: 'thumbnail', message: '' }, { actorId: ACTOR_ID }, null, { message: REFUSAL }] }));
    expect(error.message).toBe(REFUSAL);
    expect(error.details).toEqual([{ path: [], message: REFUSAL }]);
  });

  it('falls back to the status text when warnings is not a list', async () => {
    const error = await refusal(JSON.stringify({ warnings: 'thumbnail refused' }));
    expect(error.message).toBe('Bad Request');
    expect(error.details).toEqual([]);
  });

  it('falls back to the status text when the body is not JSON', async () => {
    const error = await refusal('<html>Bad gateway</html>');
    expect(error.message).toBe('Bad Request');
    expect(error.details).toEqual([]);
  });

  it('prefers the details the API sends over its warnings', async () => {
    const details = [{ path: ['name'], message: 'Required' }];
    const error = await refusal(JSON.stringify({ message: 'Validation failed', details, warnings: [{ actorId: ACTOR_ID, field: 'thumbnail', message: REFUSAL }] }));
    expect(error.message).toBe('Validation failed');
    expect(error.details).toEqual(details);
  });

  it('keeps the warnings as details when the API also sends a message', async () => {
    const error = await refusal(JSON.stringify({ message: 'Actor update refused', warnings: [{ actorId: ACTOR_ID, field: 'thumbnail', message: REFUSAL }] }));
    expect(error.message).toBe('Actor update refused');
    expect(error.details).toEqual([{ path: [ACTOR_ID, 'thumbnail'], message: REFUSAL }]);
  });
});

describe('app thumbnail and app URL routes', () => {
  const ok = (body: unknown) => stubFetch(JSON.stringify(body), { status: 200 });

  it('reads a stored thumbnail from the canvas actor-thumbnails route', async () => {
    const fetchMock = ok({ dataUrl: 'data:image/png;base64,AAAA' });
    await expect(client.getActorThumbnailData('o', 'w', 'cnv', 'FILE01')).resolves.toEqual({ dataUrl: 'data:image/png;base64,AAAA' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/orgs/o/workspaces/w/canvases/cnv/actor-thumbnails/FILE01/data',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it("reads an app's serving URL from the apps trigger route", async () => {
    const fetchMock = ok({ src: 'https://apps.test/v1/app/tok/' });
    await expect(client.getAppTrigger('o', 'w', 'cnv', ACTOR_ID)).resolves.toEqual({ src: 'https://apps.test/v1/app/tok/' });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.test/orgs/o/workspaces/w/canvases/cnv/apps/${ACTOR_ID}/trigger`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
