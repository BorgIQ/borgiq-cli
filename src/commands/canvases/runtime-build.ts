import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, ExitCode } from '../../lib/errors.js';
import type { RuntimeBuildSummary } from '../../client/types.js';

/** How long each long-poll request holds open. The server caps this. */
const POLL_WINDOW_SECONDS = 20;

interface RuntimeBuildOptions {
  wait?: boolean;
  timeout?: string;
}

/** Statuses that mean the build is still going. */
const IN_PROGRESS = ['pending', 'building'];

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
 * Without `--wait` it starts the build and returns. With `--wait` it long-polls until the build
 * finishes or the timeout elapses, then prints the per-actor outcome.
 *
 * Exit codes: 0 when the build completed (even partly — the actors that built still start from it,
 * and the failures are printed), non-zero when the build failed outright or the wait timed out.
 */
export const canvasesRuntimeBuild = async (
  canvas: string,
  options: RuntimeBuildOptions,
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const started = await client.startRuntimeBuild(ctx.org, ctx.workspace, canvas);
    const build = started.build;
    if (!build) {
      process.stderr.write('The build was started but the server returned no build record.\n');
      process.exit(ExitCode.GENERAL);
    }

    if (!options.wait) {
      output(build, globalOpts);
      return;
    }

    const timeoutSeconds = Number(options.timeout ?? 600);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let current = build;

    while (IN_PROGRESS.includes(current.status)) {
      if (Date.now() >= deadline) {
        process.stderr.write(`Timed out after ${timeoutSeconds}s waiting for the build to finish. It is still running — check again with 'borgiq canvases runtime-build-status ${canvas}'.\n`);
        process.exit(ExitCode.GENERAL);
      }
      const result = await client.getRuntimeBuild(ctx.org, ctx.workspace, canvas, {
        buildId: build.id,
        waitSeconds: Math.min(POLL_WINDOW_SECONDS, Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
      });
      if ('build' in result && result.build) current = result.build;
    }

    if (globalOpts.json) {
      output(current, globalOpts);
    } else {
      output(actorRows(current), globalOpts, {
        columns: [
          { key: 'actor', header: 'ACTOR' },
          { key: 'type', header: 'TYPE' },
          { key: 'status', header: 'STATUS' },
          { key: 'note', header: 'NOTE' },
        ],
        title: `Build ${current.id} — ${current.status}`,
      });
      if (current.error) process.stderr.write(`\n${current.error}\n`);
    }

    if (current.status === 'failed') {
      process.exit(ExitCode.GENERAL);
    }
    if (current.status === 'partially_ready') {
      // Not a failure: the actors that built still run from the build. Say so on stderr so a script
      // that only checks the exit code is not misled by the warning either way.
      const failed = Object.values(current.actors ?? {}).filter((actor) => actor.status !== 'ok').length;
      process.stderr.write(`\nWarning: ${failed} actor(s) did not build and will run without the build.\n`);
    }
  } catch (error) {
    handleError(error);
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
