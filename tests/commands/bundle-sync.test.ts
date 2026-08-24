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
import { assembleBundle } from '../../src/lib/bundle/assemble.js';
import { actorContentHash, actorContentHashes } from '../../src/lib/bundle/diff.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import type { CanvasExportDocument } from '../../src/lib/bundle/types.js';
import { stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { readBundleDir, writeBundleDir } from '../../src/lib/bundleFs.js';
import { ExitCode } from '../../src/lib/errors.js';
import {
  DENO_PROJECT,
  LEGACY_DENO_CODE,
  TASK_ID,
  makeActor,
  makeDenoActor,
  makeDoc,
  makeLegacyDenoActor,
} from '../bundle/fixtures.js';

const ACTOR_ID = 'ACTR01sync0000000000000000000';
const command = { parent: { parent: { opts: () => ({ json: true }) } } };

const actor = (name: string) => makeActor({
  id: ACTOR_ID,
  type: 'EchoActor',
  name,
});

const envelope = (doc: CanvasExportDocument, errors: unknown[] = []) => ({
  yaml: stringifyYamlDoc(doc),
  errors,
});

const successfulBatch = (actorId = ACTOR_ID) => ({
  processed: [actorId],
  appliedOperations: [{ type: 'update', actorId, newEditVersion: 2 }],
  conflicts: [],
  updatedAt: '2026-07-09T12:00:00.000Z',
});

const makeClient = () => ({
  exportCanvas: vi.fn(),
  getCanvas: vi.fn(),
  batchActorOperations: vi.fn(),
  updateCanvas: vi.fn(),
  layoutCanvas: vi.fn(),
  importCanvasData: vi.fn(),
  createCanvasWithData: vi.fn(),
});

let root: string;
let bundleDir: string;
let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-command-test-'));
  bundleDir = path.join(root, 'test.borgiq-canvas');
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({
    client,
    ctx: { org: 'test-org', workspace: 'test-workspace' },
  });
  mocks.output.mockReset();
  process.exitCode = undefined;
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderr.mockRestore();
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.clearAllMocks();
});

const writeLocal = (
  doc: CanvasExportDocument,
  actorVersions?: Record<string, number>,
  baseline: CanvasExportDocument = doc,
): void => {
  writeBundleDir(bundleDir, disassemble(doc, {
    actorVersions,
    actorHashes: actorVersions ? actorContentHashes(baseline) : undefined,
  }).files);
};

describe('bundle push sync orchestration', () => {
  it('performs no mutations during a dry run', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });

    await bundlePush(bundleDir, { dryRun: true }, command);

    expect(client.batchActorOperations).not.toHaveBeenCalled();
    expect(client.updateCanvas).not.toHaveBeenCalled();
    expect(client.layoutCanvas).not.toHaveBeenCalled();
    expect(client.exportCanvas).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('aborts a preflight conflict without mutating or refreshing', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server edit')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, makeDoc([actor('Common base')]));
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 2 } });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(client.batchActorOperations).not.toHaveBeenCalled();
    expect(client.updateCanvas).not.toHaveBeenCalled();
    expect(client.exportCanvas).toHaveBeenCalledTimes(1);
  });

  it('stops before metadata and refresh when the batch response does not confirm an operation', async () => {
    const local = makeDoc([actor('Local edit')], { name: 'Local canvas' });
    const server = makeDoc([actor('Server copy')], { name: 'Server canvas' });
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue({
      processed: [],
      appliedOperations: [],
      conflicts: [],
      updatedAt: '2026-07-09T12:00:00.000Z',
    });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.GENERAL);
    expect(client.updateCanvas).not.toHaveBeenCalled();
    expect(client.exportCanvas).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(ACTOR_ID));
  });

  it('treats a non-success operation status as unconfirmed even when processed includes the actor', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue({
      processed: [ACTOR_ID],
      appliedOperations: [{ type: 'update', actorId: ACTOR_ID, newEditVersion: 1, status: 'failed' }],
      conflicts: [],
      updatedAt: '2026-07-09T12:00:00.000Z',
    });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.GENERAL);
    expect(client.exportCanvas).toHaveBeenCalledTimes(1);
  });

  it('reports in-flight conflicts and skips the refresh', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue({
      processed: [],
      appliedOperations: [],
      conflicts: [{ actorId: ACTOR_ID, newEditVersion: 2 }],
      updatedAt: '2026-07-09T12:00:00.000Z',
    });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(client.exportCanvas).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('no refresh was performed'));
  });

  it('refreshes local actor version markers after a confirmed batch', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas
      .mockResolvedValueOnce(envelope(server))
      .mockResolvedValueOnce(envelope(local));
    client.getCanvas
      .mockResolvedValueOnce({ actorVersions: { [ACTOR_ID]: 1 } })
      .mockResolvedValueOnce({ actorVersions: { [ACTOR_ID]: 2 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBeUndefined();
    expect(client.batchActorOperations).toHaveBeenCalledTimes(1);
    expect(client.exportCanvas).toHaveBeenCalledTimes(2);
    const refreshed = assembleBundle(readBundleDir(bundleDir));
    expect(refreshed.sync.actors).toEqual({
      [ACTOR_ID]: { editVersion: 2, contentHash: actorContentHash(local.data.actors[ACTOR_ID]) },
    });
  });

  it('forwards --strict to the actor batch API', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());

    await bundlePush(bundleDir, { strict: true, refresh: false }, command);

    expect(client.batchActorOperations).toHaveBeenCalledWith(
      'test-org',
      'test-workspace',
      'test-canvas',
      expect.objectContaining({ operations: expect.any(Array) }),
      { strict: true },
    );
  });

  it('treats a server deletion as a push conflict instead of resurrecting it', async () => {
    const local = makeDoc([actor('Deleted remotely')]);
    const server = makeDoc([]);
    writeLocal(local, { [ACTOR_ID]: 1 });
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: {} });

    await bundlePush(bundleDir, { dryRun: true }, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('deleted-on-server'));
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ deletedOnServer: 1 }),
    }), { json: true });
  });

  it('warns and fails closed when the bundle has no sync baseline', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 4 } });

    await bundlePush(bundleDir, { dryRun: true }, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('no content-hash sync baseline'));
  });

  it('aborts before diffing when the server export reports actor errors', async () => {
    const local = makeDoc([actor('Local edit')]);
    writeLocal(local, { [ACTOR_ID]: 1 });
    client.exportCanvas.mockResolvedValue(envelope(local, [{ actorId: ACTOR_ID, field: 'configuration.options', error: 'invalid YAML' }]));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.GENERAL);
    expect(client.batchActorOperations).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('sync baseline is incomplete'));
  });

  it('does not refresh local files when the post-push export reports errors', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server copy')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, server);
    const before = readBundleDir(bundleDir);
    client.exportCanvas
      .mockResolvedValueOnce(envelope(server))
      .mockResolvedValueOnce(envelope(local, [{ actorId: ACTOR_ID, error: 'invalid YAML' }]));
    client.getCanvas
      .mockResolvedValueOnce({ actorVersions: { [ACTOR_ID]: 1 } })
      .mockResolvedValueOnce({ actorVersions: { [ACTOR_ID]: 2 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch());

    await bundlePush(bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.GENERAL);
    expect(readBundleDir(bundleDir)).toEqual(before);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No local files were refreshed'));
  });

  it('includes raw legacy import responses only when --raw is set', async () => {
    const local = makeDoc([actor('Local')]);
    const response = successfulBatch();
    writeLocal(local, { [ACTOR_ID]: 1 });
    client.importCanvasData.mockResolvedValue(response);

    await bundlePush(bundleDir, { mode: 'merge', raw: true }, command);

    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({
      raw: { import: response, layout: undefined },
    }), { json: true });
  });

  it('includes raw create responses only when --raw is set', async () => {
    const local = makeDoc([actor('Local')]);
    const response = { id: 'CNVS01created00000000000000000', slug: 'test-canvas' };
    writeLocal(local, { [ACTOR_ID]: 1 });
    client.createCanvasWithData.mockResolvedValue(response);

    await bundlePush(bundleDir, { create: true, raw: true }, command);

    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({
      raw: { canvas: response, layout: undefined },
    }), { json: true });
  });
});

describe('bundle pull sync orchestration', () => {
  it('refuses to overwrite concurrent local and server edits', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server edit')]);
    writeLocal(local, { [ACTOR_ID]: 1 }, makeDoc([actor('Common base')]));
    const before = readBundleDir(bundleDir);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 2 } });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(process.exitCode).toBe(ExitCode.CONFLICT);
    expect(readBundleDir(bundleDir)).toEqual(before);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No files were written'));
  });

  it('fast-forwards a server-only edit when the local actor is unchanged', async () => {
    const baseline = makeDoc([actor('Common base')]);
    const server = makeDoc([actor('Server edit')]);
    writeLocal(baseline, { [ACTOR_ID]: 1 }, baseline);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 2 } });

    await bundlePull('test-canvas', bundleDir, {}, command);

    const pulled = assembleBundle(readBundleDir(bundleDir));
    expect(process.exitCode).toBeUndefined();
    expect(pulled.doc.data.actors[ACTOR_ID].name).toBe('Server edit');
    expect(pulled.sync.actors?.[ACTOR_ID]).toEqual({
      editVersion: 2,
      contentHash: actorContentHash(server.data.actors[ACTOR_ID]),
    });
  });

  it('preserves a local deletion when the server actor is unchanged', async () => {
    const baseline = makeDoc([actor('Delete locally')]);
    writeLocal(makeDoc([]), { [ACTOR_ID]: 1 }, baseline);
    client.exportCanvas.mockResolvedValue(envelope(baseline));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 1 } });

    await bundlePull('test-canvas', bundleDir, {}, command);

    const pulled = assembleBundle(readBundleDir(bundleDir));
    expect(process.exitCode).toBeUndefined();
    expect(pulled.doc.data.actors[ACTOR_ID]).toBeUndefined();
    expect(pulled.sync.actors?.[ACTOR_ID]).toEqual({
      editVersion: 1,
      contentHash: actorContentHash(baseline.data.actors[ACTOR_ID]),
    });
  });

  it('uses --replace as an explicit server-wins pull', async () => {
    const local = makeDoc([actor('Local edit')]);
    const server = makeDoc([actor('Server edit')]);
    writeLocal(local, { [ACTOR_ID]: 1 });
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 2 } });

    await bundlePull('test-canvas', bundleDir, { replace: true }, command);

    const pulled = assembleBundle(readBundleDir(bundleDir));
    expect(process.exitCode).toBeUndefined();
    expect(pulled.doc.data.actors[ACTOR_ID].name).toBe('Server edit');
    expect(pulled.sync.actors?.[ACTOR_ID].editVersion).toBe(2);
  });

  it('prints export warnings during dry-run', async () => {
    const server = makeDoc([actor('Server copy')]);
    client.exportCanvas.mockResolvedValue(envelope(server, [{ actorId: ACTOR_ID, error: 'invalid YAML' }]));
    client.getCanvas.mockResolvedValue({ actorVersions: { [ACTOR_ID]: 2 } });

    await bundlePull('test-canvas', bundleDir, { dryRun: true }, command);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('export reported 1 actor error'));
    expect(fs.existsSync(bundleDir)).toBe(false);
  });
});

describe('multi-file code actor sync', () => {
  const DENO_CODE_DIR = `actors/tasks/deno/${TASK_ID}/code`;

  const pushed = (): Record<string, unknown> => {
    const [, , , body] = client.batchActorOperations.mock.calls[0] as [string, string, string, { operations: { data: Record<string, unknown> }[] }];
    return body.operations[0].data.configuration as Record<string, unknown>;
  };

  it('pulls a legacy code string into the entrypoint file, and the next push sends codeDir', async () => {
    const server = makeDoc([makeLegacyDenoActor()]);
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [TASK_ID]: 1 } });

    await bundlePull('test-canvas', bundleDir, {}, command);

    expect(fs.readFileSync(path.join(bundleDir, DENO_CODE_DIR, 'main.ts'), 'utf-8')).toBe(LEGACY_DENO_CODE);

    // The pulled bundle is already the migrated shape, so pushing it migrates the actor.
    client.batchActorOperations.mockResolvedValue(successfulBatch(TASK_ID));
    client.exportCanvas.mockResolvedValue(envelope(makeDoc([makeLegacyDenoActor({ name: 'Server copy' })])));
    client.getCanvas.mockResolvedValue({ actorVersions: { [TASK_ID]: 1 } });

    await bundlePush(bundleDir, { forceLocal: true }, command);

    expect(pushed().codeDir).toEqual([{ path: 'main.ts', content: LEGACY_DENO_CODE }]);
    expect(pushed().code).toBeUndefined();
  });

  it('pushes the whole tree when one helper file changes locally', async () => {
    const server = makeDoc([makeDenoActor()]);
    writeLocal(server, { [TASK_ID]: 1 }, server);
    fs.writeFileSync(path.join(bundleDir, DENO_CODE_DIR, 'lib/greeting.ts'), 'export const greeting = () => "edited";\n');
    client.exportCanvas.mockResolvedValue(envelope(server));
    client.getCanvas.mockResolvedValue({ actorVersions: { [TASK_ID]: 1 } });
    client.batchActorOperations.mockResolvedValue(successfulBatch(TASK_ID));

    await bundlePush(bundleDir, {}, command);

    expect(pushed().codeDir).toEqual([
      { path: 'lib/greeting.ts', content: 'export const greeting = () => "edited";\n' },
      { path: 'main.ts', content: DENO_PROJECT[1].content },
    ]);
  });

  it('sees no local edit when the server returns the same tree in a different order', async () => {
    const server = makeDoc([makeDenoActor()]);
    writeLocal(server, { [TASK_ID]: 1 }, server);
    const unordered = makeDoc([makeDenoActor({
      configuration: {
        codeDir: [...DENO_PROJECT].reverse().map((file) => ({ ...file })),
        inputs: {},
        options: { allowNet: true, allowFs: true },
      },
    })]);
    client.exportCanvas.mockResolvedValue(envelope(unordered));
    client.getCanvas.mockResolvedValue({ actorVersions: { [TASK_ID]: 1 } });

    await bundlePush(bundleDir, { dryRun: true }, command);

    const summary = mocks.output.mock.calls[0][0] as { summary: { updated: number; unchanged: number } };
    expect(summary.summary).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('refuses to pull a shape it cannot represent, pointing at the upgrade', async () => {
    const future = makeDoc([makeActor({
      id: TASK_ID,
      type: 'AppTriggerActor',
      configuration: { codeDir: [{ path: 'index.html', content: '<h1>hi</h1>' }], options: {} },
    })]);
    client.exportCanvas.mockResolvedValue(envelope(future));
    client.getCanvas.mockResolvedValue({ actorVersions: { [TASK_ID]: 1 } });
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${String(code)}`);
    }) as never);

    // A fatal bundle error exits the process rather than writing a half-built bundle.
    await expect(bundlePull('test-canvas', bundleDir, {}, command)).rejects.toThrow(`exit:${ExitCode.GENERAL}`);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('upgrade @borgiq/cli'));
    expect(fs.existsSync(bundleDir)).toBe(false);
    exit.mockRestore();
  });
});
