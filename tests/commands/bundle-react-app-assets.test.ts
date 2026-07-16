import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

import { bundlePull } from '../../src/commands/bundle/pull.js';
import { bundlePush } from '../../src/commands/bundle/push.js';
import { actorContentHashes } from '../../src/lib/bundle/diff.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { CanvasExportDocument } from '../../src/lib/bundle/types.js';
import { writeBundleDir } from '../../src/lib/bundleFs.js';
import { ExitCode } from '../../src/lib/errors.js';
import { REACT_APP_ID, REACT_APP_PROJECT, makeActor, makeDoc, makeReactAppActor } from '../bundle/fixtures.js';

const HERO = 'src/assets/hero.png';
const HERO_BUNDLE_PATH = `actors/triggers/react-app/${REACT_APP_ID}/code/${HERO}`;
const ASSET_ID = 'ASET01hero000000000000000000000';
const FILE_ID = 'FILE01hero000000000000000000000';
const PRESIGNED_GET = 'https://storage.example.invalid/get/hero.png?sig=abc';
const PRESIGNED_POST = { url: 'https://storage.example.invalid/post', fields: { key: 'uploads/hero.png' } };

const SERVER_BYTES = Buffer.from('server-hero-bytes');
const LOCAL_BYTES = Buffer.from('local-hero-bytes');

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const heroEntry = { path: HERO, content: '${{ assets["hero.png"] }}' };

const reactAppDoc = (files: { path: string; content: unknown }[] = [heroEntry]): CanvasExportDocument =>
  makeDoc([makeReactAppActor({
    configuration: { codeDir: REACT_APP_PROJECT.map((file) => ({ ...file })), options: { files } },
  })]);

const envelope = (doc: CanvasExportDocument, errors: unknown[] = []) => ({ yaml: stringifyYamlDoc(doc), errors });

const assetSummary = (over: Record<string, unknown> = {}) => ({
  id: ASSET_ID,
  key: 'hero.png',
  type: 'file',
  createdAt: '2026-07-01T00:00:00.000Z',
  file: { id: FILE_ID, fileName: 'hero.png', sizeInBytes: SERVER_BYTES.length, mimeType: 'image/png', status: 'upload_success', storageEngine: 's3', sha256: sha(SERVER_BYTES) },
  ...over,
});

const makeClient = () => ({
  exportCanvas: vi.fn(),
  getCanvas: vi.fn(),
  batchActorOperations: vi.fn(),
  updateCanvas: vi.fn(),
  layoutCanvas: vi.fn(),
  importCanvasData: vi.fn(),
  createCanvasWithData: vi.fn(),
  listAssets: vi.fn().mockResolvedValue({ total: 0, data: [] }),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  getAssetData: vi.fn(),
  updateFileUpload: vi.fn().mockResolvedValue({}),
  deleteAsset: vi.fn(),
});

const successfulBatch = () => ({
  processed: [REACT_APP_ID],
  appliedOperations: [{ type: 'update', actorId: REACT_APP_ID, newEditVersion: 2 }],
  conflicts: [],
  updatedAt: '2026-07-09T12:00:00.000Z',
});

let root: string;
let bundleDir: string;
let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-asset-test-'));
  bundleDir = path.join(root, 'test.borgiq-canvas');
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  process.exitCode = undefined;
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  fetchMock = vi.fn(async (url: string) => {
    if (url === PRESIGNED_GET) return { ok: true, arrayBuffer: async () => SERVER_BYTES.buffer.slice(SERVER_BYTES.byteOffset, SERVER_BYTES.byteOffset + SERVER_BYTES.length) };
    if (url === PRESIGNED_POST.url) return { ok: true, status: 204, statusText: 'No Content' };
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  stderr.mockRestore();
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.clearAllMocks();
});

const writeLocal = (
  doc: CanvasExportDocument,
  actorVersions?: Record<string, number>,
  baseline: CanvasExportDocument = doc,
  reactAppAssets?: Record<string, Record<string, { assetId: string; assetKey: string; sha256: string }>>,
): void => {
  writeBundleDir(bundleDir, disassemble(doc, {
    actorVersions,
    actorHashes: actorVersions ? actorContentHashes(baseline) : undefined,
    reactAppAssets,
  }).files);
};

const writeLocalAsset = (bytes: Buffer): void => {
  const abs = path.join(bundleDir, HERO_BUNDLE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
};

const baselineOf = (sha256: string) => ({ [REACT_APP_ID]: { [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256 } } });

const syncBaselines = (): Record<string, unknown> => {
  const root = parseYamlDoc(fs.readFileSync(path.join(bundleDir, 'canvas.yaml'), 'utf-8')) as Record<string, unknown>;
  return (root.sync as Record<string, unknown>) ?? {};
};

const messages = (): string => stderr.mock.calls.map((call) => String(call[0])).join('');

describe('bundle pull: react-app assets', () => {
  it('downloads a referenced asset and records its baseline', async () => {
    const server = reactAppDoc();
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.getAssetData.mockResolvedValue(PRESIGNED_GET);

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(fs.readFileSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toEqual(SERVER_BYTES);
    expect(syncBaselines().reactAppAssets).toEqual({
      [REACT_APP_ID]: { [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256: sha(SERVER_BYTES) } },
    });
    expect(client.getAssetData).toHaveBeenCalledWith('test-org', 'test-workspace', ASSET_ID);
  });

  it('sends no Authorization header to the storage host', async () => {
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc()));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.getAssetData.mockResolvedValue(PRESIGNED_GET);

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(fetchMock).toHaveBeenCalledWith(PRESIGNED_GET);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('leaves a locally edited asset alone and keeps it for the next push', async () => {
    const doc = reactAppDoc();
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(SERVER_BYTES)));
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(fs.readFileSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toEqual(LOCAL_BYTES);
    expect(client.getAssetData).not.toHaveBeenCalled();
  });

  it('aborts on an asset conflict, and --replace downgrades it to a download', async () => {
    const doc = reactAppDoc();
    const staleBaseline = baselineOf(sha(Buffer.from('older-bytes')));
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, staleBaseline);
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.getAssetData.mockResolvedValue(PRESIGNED_GET);

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(fs.readFileSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toEqual(LOCAL_BYTES);
    expect(messages()).toMatch(/asset conflict\(s\)/);

    process.exitCode = undefined;
    await bundlePull('test-canvas', bundleDir, { replace: true, force: true }, command);

    expect(fs.readFileSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toEqual(SERVER_BYTES);
  });

  it('deletes a local asset the actor no longer references', async () => {
    const doc = reactAppDoc([]);
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(SERVER_BYTES)));
    writeLocalAsset(SERVER_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(fs.existsSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toBe(false);
  });

  it('warns and skips when the referenced asset is gone from the workspace', async () => {
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc()));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 0, data: [] });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(messages()).toMatch(/no longer exists in this workspace/);
    expect(fs.existsSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toBe(false);
  });

  it('downloads and hashes an asset the workspace has no digest for', async () => {
    const doc = reactAppDoc();
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(SERVER_BYTES)));
    writeLocalAsset(SERVER_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary({ file: { id: FILE_ID, fileName: 'hero.png', sizeInBytes: 1, mimeType: 'image/png', status: 'upload_success', storageEngine: 's3' } })] });
    client.getAssetData.mockResolvedValue(PRESIGNED_GET);

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(messages()).toMatch(/has no recorded digest; downloading it to compare/);
    expect(fs.readFileSync(path.join(bundleDir, HERO_BUNDLE_PATH))).toEqual(SERVER_BYTES);
  });

  it('makes no asset call for a canvas with no react-app actor', async () => {
    const doc = makeDoc([makeActor({ id: 'ACTR01echo0000000000000000000', type: 'EchoActor' })]);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: {} });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(client.listAssets).not.toHaveBeenCalled();
    expect(client.getAssetData).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes nothing during a dry run', async () => {
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc()));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });

    await bundlePull('test-canvas', bundleDir, { dryRun: true }, command);

    expect(fs.existsSync(bundleDir)).toBe(false);
    expect(client.getAssetData).not.toHaveBeenCalled();
  });
});

describe('bundle push: react-app assets', () => {
  const stubCreate = () => {
    client.createAsset.mockResolvedValue({
      asset: { id: ASSET_ID, key: 'hero.png', type: 'file', file: { id: FILE_ID } },
      presignedUrl: PRESIGNED_POST,
    });
  };

  it('uploads a new asset, patches options.files, and records the baseline', async () => {
    const local = reactAppDoc([]);
    const server = reactAppDoc([]);
    writeLocal(local, { [REACT_APP_ID]: 1 }, server);
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas
      .mockResolvedValueOnce(envelope(server))
      .mockResolvedValueOnce(envelope(reactAppDoc([heroEntry])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());
    stubCreate();
    client.listAssets.mockResolvedValue({ total: 0, data: [] });

    await bundlePush(bundleDir, {}, command);

    expect(client.createAsset).toHaveBeenCalledWith('test-org', 'test-workspace', {
      type: 'file',
      key: 'hero.png',
      file: { fileName: 'hero.png', mimeType: 'image/png', sizeInBytes: LOCAL_BYTES.length },
    });
    expect(client.updateFileUpload).toHaveBeenCalledWith('test-org', 'test-workspace', FILE_ID, {
      status: 'upload_success',
      md5: expect.any(String),
      sha256: sha(LOCAL_BYTES),
    });

    // The uploaded asset reaches the server as an options.files entry on the actor.
    const operations = client.batchActorOperations.mock.calls[0][3].operations;
    const options = parseYamlDoc(operations[0].data.configuration.options) as { files: unknown[] };
    expect(options.files).toEqual([heroEntry]);

    expect(syncBaselines().reactAppAssets).toEqual({
      [REACT_APP_ID]: { [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256: sha(LOCAL_BYTES) } },
    });
  });

  it('updates an asset in place when only the local file changed', async () => {
    const doc = reactAppDoc();
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(SERVER_BYTES)));
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.updateAsset.mockResolvedValue({
      asset: { id: ASSET_ID, key: 'hero.png', type: 'file', file: { id: FILE_ID } },
      presignedUrl: PRESIGNED_POST,
    });

    await bundlePush(bundleDir, {}, command);

    expect(client.updateAsset).toHaveBeenCalledWith('test-org', 'test-workspace', ASSET_ID, {
      type: 'file',
      key: 'hero.png',
      file: { fileName: 'hero.png', mimeType: 'image/png', sizeInBytes: LOCAL_BYTES.length },
      updateFile: true,
    });
    expect(client.createAsset).not.toHaveBeenCalled();
  });

  it('adopts an existing asset with identical content instead of erroring', async () => {
    const local = reactAppDoc([]);
    writeLocal(local, { [REACT_APP_ID]: 1 }, local);
    writeLocalAsset(SERVER_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc([])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });

    await bundlePush(bundleDir, { refresh: false }, command);

    expect(client.createAsset).not.toHaveBeenCalled();
    expect(client.updateAsset).not.toHaveBeenCalled();
    expect(messages()).toMatch(/Adopted existing asset 'hero\.png'/);
  });

  it('errors when the key is taken by different content, before uploading anything', async () => {
    const local = reactAppDoc([]);
    writeLocal(local, { [REACT_APP_ID]: 1 }, local);
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc([])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.USAGE);
    expect(messages()).toMatch(/already exists with different content/);
    expect(client.createAsset).not.toHaveBeenCalled();
    expect(client.batchActorOperations).not.toHaveBeenCalled();
  });

  it('removes the entry but keeps the workspace asset when the local file is deleted', async () => {
    const doc = reactAppDoc();
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(SERVER_BYTES)));
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.batchActorOperations.mockResolvedValue(successfulBatch());

    await bundlePush(bundleDir, { refresh: false }, command);

    const operations = client.batchActorOperations.mock.calls[0][3].operations;
    const options = parseYamlDoc(operations[0].data.configuration.options) as { files: unknown[] };
    expect(options.files).toEqual([]);
    expect(client.deleteAsset).not.toHaveBeenCalled();
    expect(messages()).toMatch(/left in the workspace - delete it with 'borgiq assets delete'/);
  });

  it('aborts on an asset conflict without uploading, and --force-local pushes through', async () => {
    const doc = reactAppDoc();
    writeLocal(doc, { [REACT_APP_ID]: 1 }, doc, baselineOf(sha(Buffer.from('older-bytes'))));
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 1, data: [assetSummary()] });
    client.updateAsset.mockResolvedValue({
      asset: { id: ASSET_ID, key: 'hero.png', type: 'file', file: { id: FILE_ID } },
      presignedUrl: PRESIGNED_POST,
    });
    client.batchActorOperations.mockResolvedValue(successfulBatch());

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(client.updateAsset).not.toHaveBeenCalled();
    expect(client.batchActorOperations).not.toHaveBeenCalled();
    expect(messages()).toMatch(/asset conflict\(s\)/);

    process.exitCode = undefined;
    await bundlePush(bundleDir, { forceLocal: true, refresh: false }, command);

    expect(client.updateAsset).toHaveBeenCalledTimes(1);
  });

  it('uploads nothing during a dry run but still previews the patched actor diff', async () => {
    const local = reactAppDoc([]);
    writeLocal(local, { [REACT_APP_ID]: 1 }, reactAppDoc([]));
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc([])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.listAssets.mockResolvedValue({ total: 0, data: [] });

    await bundlePush(bundleDir, { dryRun: true }, command);

    expect(client.createAsset).not.toHaveBeenCalled();
    expect(client.updateAsset).not.toHaveBeenCalled();
    expect(client.batchActorOperations).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // The preview reflects the entry the real run would add, so the two agree.
    const payload = mocks.output.mock.calls[0][0] as { assets: { action: string; path: string }[]; summary: { updated: number } };
    expect(payload.assets).toEqual([{ action: 'upload-new', path: HERO }]);
    expect(payload.summary.updated).toBe(1);
  });

  it('makes no asset call for a canvas with no react-app actor', async () => {
    const doc = makeDoc([makeActor({ id: 'ACTR01echo0000000000000000000', type: 'EchoActor' })]);
    writeLocal(doc, { ACTR01echo0000000000000000000: 1 }, doc);
    client.exportCanvas.mockResolvedValue(envelope(doc));
    client.getCanvas.mockResolvedValue({ actorVersions: { ACTR01echo0000000000000000000: 1 } });

    await bundlePush(bundleDir, { refresh: false }, command);

    expect(client.listAssets).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns that --no-refresh leaves no asset baselines behind', async () => {
    const local = reactAppDoc([]);
    writeLocal(local, { [REACT_APP_ID]: 1 }, reactAppDoc([]));
    writeLocalAsset(LOCAL_BYTES);
    client.exportCanvas.mockResolvedValue(envelope(reactAppDoc([])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [REACT_APP_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());
    client.listAssets.mockResolvedValue({ total: 0, data: [] });
    stubCreate();

    await bundlePush(bundleDir, { refresh: false }, command);

    expect(messages()).toMatch(/--no-refresh skipped the local refresh, so no asset sync baselines were recorded/);
  });

  it('warns that legacy --mode does not sync assets', async () => {
    const local = reactAppDoc();
    writeLocal(local, { [REACT_APP_ID]: 1 }, local);
    client.importCanvasData.mockResolvedValue({ appliedOperations: [], conflicts: [] });

    await bundlePush(bundleDir, { mode: 'merge' }, command);

    expect(messages()).toMatch(/--mode uses the legacy whole-document import path, which does not sync react-app assets/);
    expect(client.listAssets).not.toHaveBeenCalled();
  });
});
