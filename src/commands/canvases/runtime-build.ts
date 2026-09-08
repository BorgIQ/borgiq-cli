import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError, ExitCode } from '../../lib/errors.js';
import { RUNTIME_BUILD_COLUMNS, partialBuildWarning, runtimeBuildActorRows } from '../../lib/runtimeBuildReport.js';
import type { RuntimeBuildSummary } from '../../client/types.js';

interface RuntimeBuildOptions {
  timeout?: string;
}

/**
 * `borgiq canvases runtime-build <canvas>` — compile the canvas's code actors ahead of time.
 *
 * Only a deployed workspace runs builds, so a non-deployed workspace is refused up front — the same
 * check that disables the Build button in the web editor. The build itself runs inside the request:
 * the command blocks until the build finishes and the response is the finished build, so there is
 * nothing to poll. `--timeout` bounds only how long this command waits — the server finishes the
 * build either way, and `runtime-build-status` shows the outcome.
 *
 * Exit codes: 0 only when every actor built (the build now serves runs). Non-zero when the build
 * failed, only partly succeeded (a partial build serves nothing — the previous full build keeps
 * running), the workspace is not deployed, or the wait timed out.
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

    const deployment = await client.getWorkspaceDeployment(ctx.org, ctx.workspace);
    if (!deployment.isDeployed) {
      throw new CliUsageError(`This workspace is not deployed, so '${canvas}' cannot be built — nothing would run the build. `
        + 'Deploy the workspace first with \'borgiq workspaces deployment --enable\'.');
    }

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
      output(runtimeBuildActorRows(build), globalOpts, {
        columns: RUNTIME_BUILD_COLUMNS,
        title: `Build ${build.id} — ${build.status}`,
      });
      if (build.error) process.stderr.write(`\n${build.error}\n`);
    }

    if (build.status === 'failed') {
      process.exit(ExitCode.GENERAL);
    }
    if (build.status === 'partially_ready') {
      // A failure of intent: only a fully built canvas can serve runs, so this build changed
      // nothing — the canvas keeps running its previous full build (or refuses runs without one).
      process.stderr.write(`\n${partialBuildWarning(build)}\n`);
      process.exit(ExitCode.GENERAL);
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
