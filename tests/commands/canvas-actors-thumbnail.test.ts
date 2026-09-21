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
import { THUMBNAIL_MAX_BYTES } from '../../src/lib/bundle/thumbnail.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const ACTOR_ID = 'ACTR01reactapp000000000000000';
const SRC = 'http://localhost:3001/v1/app/tok/';
const command = { optsWithGlobals: () => ({ json: true }) } as unknown as Command;
const humanCommand = { optsWithGlobals: () => ({ json: false }) } as unknown as Command;

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
const stderrIsTTY = process.stderr.isTTY;

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
  Object.defineProperty(process.stderr, 'isTTY', { value: stderrIsTTY, configurable: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

const stderrText = (): string => stderr.mock.calls.map((call) => String(call[0])).join('');

/** The confirmations are for a person at a terminal: they are gated on stderr being one. */
const onTerminal = (isTTY = true): void => {
  Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
};

const writePng = (name = 'shot.png'): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, PNG);
  return file;
};

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

  it.each([
    ['a path that does not exist', () => path.join(dir, 'missing.png')],
    ['a directory', () => dir],
  ])('refuses %s as a usage error, before calling the API', async (_label, imagePath) => {
    await expect(canvasActorsThumbnailSet('cnv', ACTOR_ID, imagePath(), {}, command)).rejects.toThrow('exit 2');
    expect(client.updateCanvasActor).not.toHaveBeenCalled();
    expect(stderrText()).toContain(`${imagePath()} is not a file.`);
  });

  it('only warns about an image over the size cap - the API decides', async () => {
    const file = path.join(dir, 'huge.png');
    fs.writeFileSync(file, Buffer.concat([PNG, Buffer.alloc(THUMBNAIL_MAX_BYTES)]));
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });

    await canvasActorsThumbnailSet('cnv', ACTOR_ID, file, {}, command);

    expect(stderrText()).toMatch(/Warning: huge\.png is 2\.00 MiB; a thumbnail may be at most 2\.00 MiB/);
    expect(client.updateCanvasActor).toHaveBeenCalledTimes(1);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, sizeInBytes: PNG.length + THUMBNAIL_MAX_BYTES, mimeType: 'image/png' });
  });

  it("exits with the usage code and the API's reason when the image is refused", async () => {
    const reason = 'Thumbnail image is corrupt.';
    client.updateCanvasActor.mockRejectedValue(new ApiError(400, reason, [{ path: [ACTOR_ID, 'thumbnail'], message: reason }]));

    await expect(canvasActorsThumbnailSet('cnv', ACTOR_ID, writePng(), {}, command)).rejects.toThrow('exit 2');

    const { error } = JSON.parse(stderrText()) as { error: Record<string, unknown> };
    expect(error).toMatchObject({ code: 'bad_request', status: 400, message: reason, details: [{ path: [ACTOR_ID, 'thumbnail'], message: reason }] });
    expect(mocks.output).not.toHaveBeenCalled();
  });

  it('reports the new edit version alone when the API echoes no actor data', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [{ actorId: ACTOR_ID, newEditVersion: 4, actorData: 'ACTR' }] });
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, writePng(), {}, command);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, sizeInBytes: PNG.length, mimeType: 'image/png', editVersion: 4 });
  });

  it('reports the upload alone when the response lists no applied operations', async () => {
    client.updateCanvasActor.mockResolvedValue({});
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, writePng(), {}, command);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, sizeInBytes: PNG.length, mimeType: 'image/png' });
  });

  // Pins today's behaviour, shared with `canvas-actors update` and `delete`: parseInt's NaN is
  // passed on, and the client sends it as `?editVersion=NaN` for the API to refuse.
  it('passes a non-numeric --edit-version on as NaN', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, writePng(), { editVersion: 'latest' }, command);
    expect(client.updateCanvasActor.mock.calls[0][5]).toBeNaN();
  });

  it('confirms on stderr for a person at a terminal, and only there', async () => {
    const file = writePng();
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });

    onTerminal(false);
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, file, {}, humanCommand);
    expect(stderrText()).toBe('');

    onTerminal();
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, file, {}, humanCommand);
    expect(stderrText()).toBe(`Thumbnail set on ${ACTOR_ID} from ${file}\n`);

    stderr.mockClear();
    await canvasActorsThumbnailSet('cnv', ACTOR_ID, file, {}, command);
    expect(stderrText()).toBe('');
  });
});

describe('canvas-actors thumbnail rm', () => {
  it('clears the field with null', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });
    await canvasActorsThumbnailRemove('cnv', ACTOR_ID, {}, command);
    expect(client.updateCanvasActor).toHaveBeenCalledWith('o', 'w', 'cnv', ACTOR_ID, { thumbnail: null }, undefined);
  });

  it('sends --edit-version and reports the version the removal produced', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [{ actorId: ACTOR_ID, newEditVersion: 8, actorData: { thumbnail: null } }] });
    await canvasActorsThumbnailRemove('cnv', ACTOR_ID, { editVersion: '7' }, command);
    expect(client.updateCanvasActor.mock.calls[0][5]).toBe(7);
    expect(mocks.output.mock.calls[0][0]).toEqual({ actorId: ACTOR_ID, thumbnail: null, editVersion: 8 });
  });

  it('exits with the conflict code when the edit version is stale', async () => {
    client.updateCanvasActor.mockRejectedValue(new ApiError(409, 'Edit version conflict'));
    await expect(canvasActorsThumbnailRemove('cnv', ACTOR_ID, { editVersion: '1' }, command)).rejects.toThrow('exit 6');
    expect(stderrText()).toContain('Edit version conflict');
  });

  it('confirms on stderr for a person at a terminal, and only there', async () => {
    client.updateCanvasActor.mockResolvedValue({ appliedOperations: [] });

    onTerminal(false);
    await canvasActorsThumbnailRemove('cnv', ACTOR_ID, {}, humanCommand);
    expect(stderrText()).toBe('');

    onTerminal();
    await canvasActorsThumbnailRemove('cnv', ACTOR_ID, {}, humanCommand);
    expect(stderrText()).toBe(`Thumbnail removed from ${ACTOR_ID}\n`);
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

  it('describes an inline image without fetching it, and never prints the base64', async () => {
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: { dataUrl: PNG_DATA_URL } });

    await canvasActorsThumbnailGet('cnv', ACTOR_ID, {}, command);

    expect(client.getActorThumbnailData).not.toHaveBeenCalled();
    const shown = mocks.output.mock.calls[0][0] as Record<string, unknown>;
    expect(shown).toEqual({ actorId: ACTOR_ID, fileId: undefined, mimeType: 'image/png', sizeInBytes: PNG.length });
    expect(shown).not.toHaveProperty('path');
    expect(JSON.stringify(shown)).not.toContain('base64');
  });

  it('refuses --out when there is no thumbnail to write, and creates no file', async () => {
    const out = path.join(dir, 'out.png');
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: null });

    await expect(canvasActorsThumbnailGet('cnv', ACTOR_ID, { out }, command)).rejects.toThrow('exit 2');

    expect(stderrText()).toContain(`has no thumbnail - nothing to write to ${out}`);
    expect(fs.existsSync(out)).toBe(false);
    expect(mocks.output).not.toHaveBeenCalled();
  });

  it('fails without writing when the API returns something that is not a data URL', async () => {
    const out = path.join(dir, 'out.png');
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: { fileId: 'FILE01' } });
    client.getActorThumbnailData.mockResolvedValue({ dataUrl: 'https://files.test/FILE01.png' });

    await expect(canvasActorsThumbnailGet('cnv', ACTOR_ID, { out }, command)).rejects.toThrow('exit 1');

    expect(stderrText()).toContain('not a base64 data URL');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('exits with the not-found code when the stored image is gone', async () => {
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: { fileId: 'FILE01' } });
    client.getActorThumbnailData.mockRejectedValue(new ApiError(404, 'Thumbnail not found'));
    await expect(canvasActorsThumbnailGet('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 5');
  });

  it('confirms a saved file on stderr for a person at a terminal, and only there', async () => {
    const out = path.join(dir, 'out.png');
    client.getCanvasActor.mockResolvedValue({ id: ACTOR_ID, thumbnail: { dataUrl: PNG_DATA_URL } });

    onTerminal(false);
    await canvasActorsThumbnailGet('cnv', ACTOR_ID, { out }, humanCommand);
    expect(stderrText()).toBe('');

    onTerminal();
    await canvasActorsThumbnailGet('cnv', ACTOR_ID, { out }, humanCommand);
    expect(stderrText()).toBe(`Thumbnail written to ${out}\n`);
    expect(fs.readFileSync(out).equals(PNG)).toBe(true);

    stderr.mockClear();
    await canvasActorsThumbnailGet('cnv', ACTOR_ID, {}, humanCommand);
    expect(stderrText()).toBe('');
  });
});

describe('canvas-actors app-url', () => {
  it('prints the serving URL', async () => {
    client.getAppTrigger.mockResolvedValue({ src: SRC });
    await canvasActorsAppUrl('cnv', ACTOR_ID, {}, command);
    expect(mocks.output).toHaveBeenCalledWith({ actorId: ACTOR_ID, src: SRC }, { json: true });
  });

  it('prints only the URL on stdout, so $(...) captures it, and the expiry note on stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    client.getAppTrigger.mockResolvedValue({ src: SRC });
    try {
      await canvasActorsAppUrl('cnv', ACTOR_ID, {}, humanCommand);
      expect(stdout.mock.calls.map((call) => String(call[0])).join('')).toBe(`${SRC}\n`);
    } finally {
      stdout.mockRestore();
    }
    expect(client.getAppTrigger).toHaveBeenCalledWith('o', 'w', 'cnv', ACTOR_ID);
    expect(stderrText()).toMatch(/Short-lived: the token in this URL expires within minutes/);
    expect(stderrText()).not.toContain(SRC);
    expect(mocks.output).not.toHaveBeenCalled();
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

  it('keeps the details of a 409 it explains', async () => {
    client.getAppTrigger.mockRejectedValue(new ApiError(409, 'No build available', [{ path: ['build'], message: 'never built' }]));
    await expect(canvasActorsAppUrl('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 6');
    expect(JSON.parse(stderrText()).error.details).toEqual([{ path: ['build'], message: 'never built' }]);
  });

  it('passes any other API error through unchanged', async () => {
    client.getAppTrigger.mockRejectedValue(new ApiError(404, 'Actor not found'));
    await expect(canvasActorsAppUrl('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 5');
    expect(JSON.parse(stderrText()).error).toMatchObject({ code: 'not_found', status: 404, message: 'Actor not found' });
  });

  it('passes a failure that is not an API error through unchanged', async () => {
    client.getAppTrigger.mockRejectedValue(new Error('socket hang up'));
    await expect(canvasActorsAppUrl('cnv', ACTOR_ID, {}, command)).rejects.toThrow('exit 1');
    expect(JSON.parse(stderrText()).error).toMatchObject({ code: 'error', status: null, message: 'socket hang up' });
  });
});
