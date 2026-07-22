import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientWithContext: vi.fn(),
  output: vi.fn(),
  bundlePush: vi.fn(),
}));

vi.mock('../../src/lib/context.js', () => ({
  createClientWithContext: mocks.createClientWithContext,
}));

vi.mock('../../src/output/index.js', () => ({
  output: mocks.output,
}));

// Auto-push reuses the real bundlePush; the build unit test stubs it to a controllable spy so it can
// isolate the build/poll/report logic from the (separately tested) push pipeline.
vi.mock('../../src/commands/bundle/push.js', () => ({
  bundlePush: mocks.bundlePush,
}));

import { bundleBuild } from '../../src/commands/bundle/build.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { writeBundleDir } from '../../src/lib/bundleFs.js';
import { ExitCode } from '../../src/lib/errors.js';
import { REACT_APP_ID, makeReactAppActor, makeDoc } from '../bundle/fixtures.js';

const CANVAS_SLUG = 'test-canvas';
const SECOND_APP_ID = 'ACTR01reactapp200000000000000';
const command = { parent: { parent: { opts: () => ({ json: true }) } } };

/** Rewrites the bundle on disk to hold the given react-app actors (default: the single fixture actor). */
const writeBundleWith = (...actors: ReturnType<typeof makeReactAppActor>[]) => {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  writeBundleDir(bundleDir, disassemble(makeDoc(actors.length ? actors : [makeReactAppActor()])).files);
};

const startResponse = (over: Record<string, unknown> = {}) => ({
  flowrun: { id: 'FLOW01build0000000000000000000', createdAt: '2026-07-21T00:00:00.000Z' },
  flowrunJob: { id: 'JOB01build00000000000000000000' },
  actorId: REACT_APP_ID,
  ...over,
});

const makeClient = () => ({
  startReactAppBuild: vi.fn(),
  getReactAppBuildResult: vi.fn(),
  getJobResultSummaries: vi.fn(),
});

let root: string;
let bundleDir: string;
let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-build-test-'));
  bundleDir = path.join(root, 'test.borgiq-canvas');
  writeBundleDir(bundleDir, disassemble(makeDoc([makeReactAppActor()])).files);

  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  mocks.bundlePush.mockReset().mockResolvedValue(undefined);
  process.exitCode = undefined;
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderr.mockRestore();
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.clearAllMocks();
});

describe('bundle build', () => {
  it('starts a build, polls past a 202, and reports the success summary', async () => {
    client.startReactAppBuild.mockResolvedValue(startResponse());
    client.getReactAppBuildResult
      .mockResolvedValueOnce({ pending: true })
      .mockResolvedValueOnce({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 3, totalSizeInBytes: 12345 });

    await bundleBuild(bundleDir, { push: false }, command);

    expect(mocks.bundlePush).not.toHaveBeenCalled();
    expect(client.startReactAppBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS_SLUG, REACT_APP_ID);
    expect(client.getReactAppBuildResult).toHaveBeenCalledTimes(2);
    expect(mocks.output).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        canvas: CANVAS_SLUG,
        builds: [expect.objectContaining({ actorId: REACT_APP_ID, status: 'success', fileCount: 3, totalSizeInBytes: 12345 })],
      }),
      expect.anything(),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('reports structured error details and exits non-zero on a failed build', async () => {
    client.startReactAppBuild.mockResolvedValue(startResponse());
    client.getReactAppBuildResult.mockResolvedValue({ status: 'error', error: 'TS2322: Type error in src/App.tsx' });
    client.getJobResultSummaries.mockResolvedValue([
      { id: 'RES01', flowrunJobId: 'JOB01build00000000000000000000', status: 'error', startedAt: '', endedAt: '', error: { code: 'TS2322', message: 'not assignable' } },
    ]);

    await bundleBuild(bundleDir, { push: false }, command);

    expect(client.getJobResultSummaries).toHaveBeenCalledWith('test-org', 'test-workspace', 'JOB01build00000000000000000000');
    expect(mocks.output).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        canvas: CANVAS_SLUG,
        builds: [expect.objectContaining({
          actorId: REACT_APP_ID,
          status: 'error',
          error: 'TS2322: Type error in src/App.tsx',
          details: [JSON.stringify({ code: 'TS2322', message: 'not assignable' })],
        })],
      }),
      expect.anything(),
    );
    expect(process.exitCode).toBe(ExitCode.GENERAL);
  });

  it('auto-pushes before building by default', async () => {
    client.startReactAppBuild.mockResolvedValue(startResponse());
    client.getReactAppBuildResult.mockResolvedValue({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 1, totalSizeInBytes: 42 });

    await bundleBuild(bundleDir, {}, command);

    expect(mocks.bundlePush).toHaveBeenCalledTimes(1);
    expect(mocks.bundlePush).toHaveBeenCalledWith(bundleDir, { canvas: undefined, forceLocal: undefined, strict: undefined }, command);
    expect(client.startReactAppBuild).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('forwards --force-local to the auto-push', async () => {
    client.startReactAppBuild.mockResolvedValue(startResponse());
    client.getReactAppBuildResult.mockResolvedValue({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 1, totalSizeInBytes: 42 });

    await bundleBuild(bundleDir, { forceLocal: true }, command);

    expect(mocks.bundlePush).toHaveBeenCalledWith(bundleDir, { canvas: undefined, forceLocal: true, strict: undefined }, command);
    expect(process.exitCode).toBeUndefined();
  });

  it('aborts without building when the auto-push fails', async () => {
    mocks.bundlePush.mockImplementation(async () => { process.exitCode = ExitCode.CONFLICT; });

    await bundleBuild(bundleDir, {}, command);

    expect(mocks.bundlePush).toHaveBeenCalledTimes(1);
    expect(client.startReactAppBuild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(ExitCode.CONFLICT);
  });

  it('builds every react-app actor on the canvas by default (one push, per-actor builds)', async () => {
    writeBundleWith(makeReactAppActor(), makeReactAppActor({ id: SECOND_APP_ID, name: 'Second App', msgVar: 'secondapp' }));
    client.startReactAppBuild
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(startResponse({ actorId: SECOND_APP_ID }));
    client.getReactAppBuildResult.mockResolvedValue({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 1, totalSizeInBytes: 42 });

    await bundleBuild(bundleDir, {}, command);

    expect(mocks.bundlePush).toHaveBeenCalledTimes(1); // one push covers the whole bundle
    expect(client.startReactAppBuild).toHaveBeenCalledTimes(2);
    expect(client.startReactAppBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS_SLUG, REACT_APP_ID);
    expect(client.startReactAppBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS_SLUG, SECOND_APP_ID);
    expect(mocks.output).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        builds: [
          expect.objectContaining({ actorId: REACT_APP_ID, status: 'success' }),
          expect.objectContaining({ actorId: SECOND_APP_ID, status: 'success' }),
        ],
      }),
      expect.anything(),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('builds only the actors named by --actor', async () => {
    writeBundleWith(makeReactAppActor(), makeReactAppActor({ id: SECOND_APP_ID, name: 'Second App', msgVar: 'secondapp' }));
    client.startReactAppBuild.mockResolvedValue(startResponse({ actorId: SECOND_APP_ID }));
    client.getReactAppBuildResult.mockResolvedValue({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 1, totalSizeInBytes: 42 });

    await bundleBuild(bundleDir, { push: false, actor: [SECOND_APP_ID] }, command);

    expect(client.startReactAppBuild).toHaveBeenCalledTimes(1);
    expect(client.startReactAppBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS_SLUG, SECOND_APP_ID);
    expect(process.exitCode).toBeUndefined();
  });

  it('fails the command if any single actor build fails', async () => {
    writeBundleWith(makeReactAppActor(), makeReactAppActor({ id: SECOND_APP_ID, name: 'Second App', msgVar: 'secondapp' }));
    client.startReactAppBuild
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(startResponse({ actorId: SECOND_APP_ID }));
    client.getReactAppBuildResult
      .mockResolvedValueOnce({ status: 'success', buildId: 'FLOW01build0000000000000000000', builtAt: '2026-07-21T00:01:00.000Z', fileCount: 1, totalSizeInBytes: 42 })
      .mockResolvedValueOnce({ status: 'error', error: 'boom' });
    client.getJobResultSummaries.mockResolvedValue([]);

    await bundleBuild(bundleDir, { push: false }, command);

    expect(client.startReactAppBuild).toHaveBeenCalledTimes(2);
    expect(mocks.output).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        builds: [
          expect.objectContaining({ actorId: REACT_APP_ID, status: 'success' }),
          expect.objectContaining({ actorId: SECOND_APP_ID, status: 'error', error: 'boom' }),
        ],
      }),
      expect.anything(),
    );
    expect(process.exitCode).toBe(ExitCode.GENERAL);
  });

  it('errors (usage) when --actor names an actor that is not in the bundle', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
    try {
      await expect(bundleBuild(bundleDir, { push: false, actor: ['ACTR01nope0000000000000000000'] }, command)).rejects.toThrow('process.exit');
      expect(exit).toHaveBeenCalledWith(ExitCode.USAGE);
      expect(client.startReactAppBuild).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });
});
