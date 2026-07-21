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
const command = { parent: { parent: { opts: () => ({ json: true }) } } };

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
      expect.objectContaining({ status: 'success', actorId: REACT_APP_ID, canvas: CANVAS_SLUG, fileCount: 3, totalSizeInBytes: 12345 }),
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
        error: 'TS2322: Type error in src/App.tsx',
        details: [JSON.stringify({ code: 'TS2322', message: 'not assignable' })],
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
    expect(mocks.bundlePush).toHaveBeenCalledWith(bundleDir, { canvas: undefined, strict: undefined }, command);
    expect(client.startReactAppBuild).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('aborts without building when the auto-push fails', async () => {
    mocks.bundlePush.mockImplementation(async () => { process.exitCode = ExitCode.CONFLICT; });

    await bundleBuild(bundleDir, {}, command);

    expect(mocks.bundlePush).toHaveBeenCalledTimes(1);
    expect(client.startReactAppBuild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(ExitCode.CONFLICT);
  });
});
