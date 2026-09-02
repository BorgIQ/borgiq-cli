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

import {
  canvasesRuntimeBuild,
  canvasesRuntimeBuildActivate,
  canvasesRuntimeBuildStatus,
} from '../../src/commands/canvases/runtime-build.js';
import { ExitCode } from '../../src/lib/errors.js';
import type { RuntimeBuildSummary } from '../../src/client/types.js';

const CANVAS = 'test-canvas';
const BUILD_ID = 'CRBD01build0000000000000000000';
const ACTOR_ID = 'ACTR01coder0000000000000000000';

const command = { parent: { parent: { opts: () => ({ json: true }) } } };
const tableCommand = { parent: { parent: { opts: () => ({ json: false }) } } };

function build(over: Partial<RuntimeBuildSummary> = {}): RuntimeBuildSummary {
  return {
    id: BUILD_ID,
    canvasId: 'CANV01test00000000000000000000',
    status: 'ready',
    runtimeSlug: 'default',
    actors: { [ACTOR_ID]: { type: 'DenoActor', hash: 'sha256:x', status: 'ok', path: `actors/task/DenoActor/${ACTOR_ID}` } },
    createdAt: '2026-08-28T00:00:00.000Z',
    isActive: true,
    ...over,
  };
}

const makeClient = () => ({
  startRuntimeBuild: vi.fn(),
  getRuntimeBuild: vi.fn(),
  listRuntimeBuilds: vi.fn(),
  activateRuntimeBuild: vi.fn(),
});

let client: ReturnType<typeof makeClient>;
let stderr: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  client = makeClient();
  mocks.createClientWithContext.mockReturnValue({ client, ctx: { org: 'test-org', workspace: 'test-workspace' } });
  mocks.output.mockReset();
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // `process.exit` ends the process for real; the command uses it for its failure codes, so it is
  // stubbed to throw and each test asserts on the code it was called with.
  exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code}`);
  }) as never);
});

afterEach(() => {
  stderr.mockRestore();
  exit.mockRestore();
  vi.clearAllMocks();
});

describe('canvases runtime-build', () => {
  it('blocks for the whole build and reports the finished build — nothing is polled', async () => {
    client.startRuntimeBuild.mockResolvedValue({ build: build({ finishedAt: '2026-08-28T00:02:00.000Z' }) });

    await canvasesRuntimeBuild(CANVAS, {}, command);

    expect(client.startRuntimeBuild).toHaveBeenCalledWith(
      'test-org', 'test-workspace', CANVAS,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.getRuntimeBuild).not.toHaveBeenCalled();
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ id: BUILD_ID, status: 'ready' }), expect.anything());
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits non-zero when the build failed outright', async () => {
    client.startRuntimeBuild.mockResolvedValue({
      build: build({ status: 'failed', isActive: false, error: 'No actor in this canvas could be built.' }),
    });

    await expect(canvasesRuntimeBuild(CANVAS, {}, command)).rejects.toThrow('process.exit:1');
    expect(exit).toHaveBeenCalledWith(ExitCode.GENERAL);
  });

  it('exits ZERO on a partly built canvas, but warns which actors did not build', async () => {
    // A partially built canvas is a success: the actors that built run from the build. Exiting
    // non-zero here would make every CI pipeline treat a working deploy as a failure.
    client.startRuntimeBuild.mockResolvedValue({
      build: build({
        status: 'partially_ready',
        actors: {
          [ACTOR_ID]: { type: 'DenoActor', hash: 'sha256:x', status: 'ok' },
          ACTR02broken000000000000000000: { type: 'DenoActor', hash: 'sha256:y', status: 'failed', error: 'error: Import "@x/y" not a dependency' },
        },
      }),
    });

    await canvasesRuntimeBuild(CANVAS, {}, command);

    expect(exit).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('1 actor(s) did not build'));
  });

  it('gives up at the timeout and says the build keeps going on the server', async () => {
    // The client rejects when its AbortSignal fires; the command reads the signal, not the error.
    client.startRuntimeBuild.mockImplementation(async (_org: string, _ws: string, _canvas: string, opts: { signal: AbortSignal }) => {
      await new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      throw new Error('unreachable');
    });

    await expect(canvasesRuntimeBuild(CANVAS, { timeout: '0' }, command)).rejects.toThrow('process.exit:1');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('keeps going on the server'));
  });

  it('renders the per-actor outcome as a table when not asked for JSON', async () => {
    client.startRuntimeBuild.mockResolvedValue({
      build: build({
        actors: {
          [ACTOR_ID]: { type: 'DenoActor', hash: 'sha256:x', status: 'ok', warm: 'failed', path: 'actors/task/DenoActor/a' },
        },
      }),
    });

    await canvasesRuntimeBuild(CANVAS, {}, tableCommand);

    expect(mocks.output).toHaveBeenCalledWith(
      [expect.objectContaining({ actor: 'actors/task/DenoActor/a', status: 'ok', note: 'installed, but did not start' })],
      expect.anything(),
      expect.objectContaining({ title: expect.stringContaining('ready') }),
    );
  });
});

describe('canvases runtime-build-status', () => {
  it('reports which build runs and whether the canvas has been edited since', async () => {
    client.getRuntimeBuild.mockResolvedValue({ activeBuild: build(), latestBuild: null, outdated: true });

    await canvasesRuntimeBuildStatus(CANVAS, {}, command);

    expect(client.getRuntimeBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS);
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ outdated: true }), expect.anything());
  });

  it('lists the history with --history', async () => {
    client.listRuntimeBuilds.mockResolvedValue({ builds: [build()] });

    await canvasesRuntimeBuildStatus(CANVAS, { history: true }, command);

    expect(client.listRuntimeBuilds).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS);
    expect(mocks.output).toHaveBeenCalledWith({ builds: [expect.objectContaining({ id: BUILD_ID })] }, expect.anything());
  });
});

describe('canvases runtime-build-activate', () => {
  it('points the canvas at the named build', async () => {
    client.activateRuntimeBuild.mockResolvedValue({ build: build() });

    await canvasesRuntimeBuildActivate(CANVAS, BUILD_ID, {}, command);

    expect(client.activateRuntimeBuild).toHaveBeenCalledWith('test-org', 'test-workspace', CANVAS, BUILD_ID);
    expect(mocks.output).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }), expect.anything());
  });
});
