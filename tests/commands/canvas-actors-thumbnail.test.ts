import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({
  output: mocks.output,
}));

import { ApiError } from '../../src/client/errors.js';
import { canvasActorsAppUrl } from '../../src/commands/canvas-actors/appUrl.js';
import { canvasActorsThumbnailGet, canvasActorsThumbnailRemove, canvasActorsThumbnailSet } from '../../src/commands/canvas-actors/thumbnail.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const ACTOR_ID = 'ACTR01reactapp000000000000000';
const command = { optsWithGlobals: () => ({ json: true }) } as unknown as Command;

const makeClient = () => ({
  updateCanvasActor: vi.fn(),
  getCanvasActor: vi.fn(),
  getActorThumbnailData: vi.fn(),
  getAppTrigger: vi.fn(),
});

let dir: string;
let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-cmd-'));
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'o', workspace: 'w' } });
  mocks.output.mockReset();
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
});

afterEach(() => {
  stderr.mockRestore();
  exit.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

const stderrText = (): string => stderr.mock.calls.map((call) => String(call[0])).join('');

describe('canvas-actors thumbnail set', () => {
  it('sends the image inline as a data URL', async () => {
    const file = path.join(dir, 'shot.png');
    fs.writeFileSync(file, PNG);
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [{ actorId: ACTOR_ID, newEditVersion: 4, actorData: { thumbnail: { fileId: 'FILE01' } } }] });

    await canvasActorsThumbnailSet('cnv', ACTOR_ID, file, { editVersion: '3' }, command);

    expect(client.updateCanvasActor).toHaveBeenCalledWith('o', 'w', 'cnv', ACTOR_ID, { thumbnail: { dataUrl: PNG_DATA_URL } }, 3);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, sizeInBytes: PNG.length, mimeType: 'image/png', editVersion: 4, thumbnail: { fileId: 'FILE01' } });
  });

  it('refuses a file that is not an image, before calling the API', async () => {
    const file = path.join(dir, 'logo.svg');
    fs.writeFileSync(file, '<svg/>');

    await expect(canvasActorsThumbnailSet('cnv', ACTOR_ID, file, {}, command)).rejects.toThrow('exit 2');
    expect(client.updateCanvasActor).not.toHaveBeenCalled();
    expect(stderrText()).toContain('not a PNG, JPEG, WebP, or GIF image');
  });
});

describe('canvas-actors thumbnail rm', () => {
  it('clears the field with null', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });
    await canvasActorsThumbnailRemove('cnv', ACTOR_ID, {}, command);
    expect(client.updateCanvasActor).toHaveBeenCalledWith('o', 'w', 'cnv', ACTOR_ID, { thumbnail: null }, undefined);
  });
});

describe('canvas-actors thumbnail get', () => {
  it('reports no thumbnail', async () => {
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID });
    await canvasActorsThumbnailGet('cnv', ACTOR_ID, {}, command);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, thumbnail: null });
  });

  it('fetches a stored image and writes its bytes', async () => {
    const out = path.join(dir, 'out.png');
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: { fileId: 'FILE01' } });
    client.getActorThumbnailData.mockResolvedValue({ dataUrl: PNG_DATA_URL });

    await canvasActorsThumbnailGet('cnv', ACTOR_ID, { out }, command);

    expect(client.getActorThumbnailData).toHaveBeenCalledWith('o', 'w', 'cnv', 'FILE01');
    expect(fs.readFileSync(out).equals(PNG)).toBe(true);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, fileId: 'FILE01', mimeType: 'image/png', sizeInBytes: PNG.length, path: out });
  });
});

describe('canvas-actors app-url', () => {
  it('prints the serving URL', async () => {
    client.getAppTrigger.mockResolvedValue({ src: 'http://localhost:3001/v1/app/tok/' });
    await canvasActorsAppUrl('cnv', ACTOR_ID, {}, command);
    expect(mocks.output).toHaveBeenCalledWith({ actorId: ACTOR_ID, src: 'http://localhost:3001/v1/app/tok/' }, { json: true });
  });

  it('says to build first when the app has no build', async () => {
    client.getAppTrigger.mockRejectedValue(new ApiError(409, 'No build available'));
    await expect(canvasActorsAppUrl('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 6');
    expect(stderrText()).toContain('borgiq bundle build');
  });

  it('names the scope on a 403', async () => {
    client.getAppTrigger.mockRejectedValue(new ApiError(403, 'Forbidden'));
    await expect(canvasActorsAppUrl('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 4');
    expect(stderrText()).toContain('app:use');
  });
});
