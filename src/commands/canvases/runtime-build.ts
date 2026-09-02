import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, ExitCode } from '../../lib/errors.js';
import type { RuntimeBuildSummary } from '../../client/types.js';

interface RuntimeBuildOptions {
  timeout?: string;
}

/** Render one build's per-actor outcome — the part a user acts on. */
function actorRows(build: RuntimeBuildSummary): Record<string, unknown>[] {
  return Object.entries(build.actors ?? {}).map(([actorId, actor]) => ({
    actor: actor.path ?? actorId,
    type: actor.type,
    status: actor.status,
    // `warm: failed` means the dependencies installed but the actor's own code threw at start-up.
    // Recorded rather than fatal, and worth surfacing: it will throw at run time too.
    note: actor.status !== 'ok' ? (actor.error ?? '') : actor.warm === 'failed' ? 'installed, but did not start' : '',
  }));
}

/**
 * `borgiq canvases runtime-build <canvas>` — compile the canvas's code actors ahead of time.
 *
 * The build runs inside the request: the command blocks until the build finishes and the response
 * is the finished build, so there is nothing to poll. `--timeout` bounds only how long this command
 * waits — the server finishes the build either way, and `runtime-build-status` shows the outcome.
 *
 * Exit codes: 0 when the build completed (even partly — the actors that built still start from it,
 * and the failures are printed), non-zero when the build failed outright or the wait timed out.
 */
export const canvasesRuntimeBuild = async (
  canvas: string,
  options: RuntimeBuildOptions,
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  const timeoutSeconds = Number(options.timeout ?? 900);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutSeconds * 1000);
  timer.unref();
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    let result: { build: RuntimeBuildSummary | null };
    try {
      result = await client.startRuntimeBuild(ctx.org, ctx.workspace, canvas, { signal: abort.signal });
    } catch (error) {
      if (abort.signal.aborted) {
        process.stderr.write(`Timed out after ${timeoutSeconds}s waiting for the build. The build itself keeps going on the server — check the outcome with 'borgiq canvases runtime-build-status ${canvas}'.\n`);
        process.exit(ExitCode.GENERAL);
      }
      throw error;
    }

    const build = result.build;
    if (!build) {
      process.stderr.write('The build finished but the server returned no build record.\n');
      process.exit(ExitCode.GENERAL);
      return;
    }

    if (globalOpts.json) {
      output(build, globalOpts);
    } else {
      output(actorRows(build), globalOpts, {
        columns: [
          { key: 'actor', header: 'ACTOR' },
          { key: 'type', header: 'TYPE' },
          { key: 'status', header: 'STATUS' },
          { key: 'note', header: 'NOTE' },
        ],
        title: `Build ${build.id} — ${build.status}`,
      });
      if (build.error) process.stderr.write(`\n${build.error}\n`);
    }

    if (build.status === 'failed') {
      process.exit(ExitCode.GENERAL);
    }
    if (build.status === 'partially_ready') {
      // Not a failure: the actors that built still run from the build. Say so on stderr so a script
      // that only checks the exit code is not misled by the warning either way.
      const failed = Object.values(build.actors ?? {}).filter((actor) => actor.status !== 'ok').length;
      process.stderr.write(`\nWarning: ${failed} actor(s) did not build and will run without the build.\n`);
    }
  } catch (error) {
    handleError(error);
  } finally {
    clearTimeout(timer);
  }
};

/** `borgiq canvases runtime-build-status <canvas>` — which build runs, and whether it is current. */
export const canvasesRuntimeBuildStatus = async (
  canvas: string,
  options: { history?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    if (options.history) {
      const { builds } = await client.listRuntimeBuilds(ctx.org, ctx.workspace, canvas);
      if (globalOpts.json) {
        output({ builds }, globalOpts);
        return;
      }
      output(
        builds.map((build) => ({
          id: build.id,
          status: build.status,
          running: build.isActive ? 'yes' : '',
          created: build.createdAt,
        })),
        globalOpts,
        {
          columns: [
            { key: 'id', header: 'BUILD' },
            { key: 'status', header: 'STATUS' },
            { key: 'running', header: 'RUNNING' },
            { key: 'created', header: 'CREATED' },
          ],
          title: 'Build history',
        },
      );
      return;
    }

    const state = await client.getRuntimeBuild(ctx.org, ctx.workspace, canvas);
    output(state, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

/** `borgiq canvases runtime-build-activate <canvas> <buildId>` — roll back to an earlier build. */
export const canvasesRuntimeBuildActivate = async (
  canvas: string,
  buildId: string,
  _options: unknown,
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const result = await client.activateRuntimeBuild(ctx.org, ctx.workspace, canvas, buildId);
    output(result.build, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
