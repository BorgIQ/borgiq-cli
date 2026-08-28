import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';

interface DeploymentOptions {
  enable?: boolean;
  disable?: boolean;
  buildAll?: boolean;
}

/**
 * Show or change whether a workspace is deployed.
 *
 * A deployed workspace's triggers run each canvas's active runtime build — a snapshot of the canvas
 * whose code actors were compiled and had their dependencies installed ahead of time — instead of the
 * canvas's current code. Edits reach triggers only after the next build; test runs always use current
 * code.
 *
 * The table is a summary; `--json` returns the full server response, including per-actor build
 * results and the reason a canvas cannot be built.
 */
export const workspacesDeployment = async (
  options: DeploymentOptions,
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    if (options.enable && options.disable) {
      throw new CliUsageError('Pass either --enable or --disable, not both.');
    }

    if (options.enable || options.disable) {
      await client.updateWorkspaceDeployment(ctx.org, ctx.workspace, Boolean(options.enable));
    }

    if (options.buildAll) {
      const result = await client.buildAllRuntimeBuilds(ctx.org, ctx.workspace);
      if (globalOpts.json) {
        output(result, globalOpts);
        return;
      }
      output(result.builds, globalOpts, {
        columns: [
          { key: 'canvasId', header: 'CANVAS' },
          { key: 'buildId', header: 'BUILD' },
        ],
        title: 'Builds started',
      });
      // A partial start must never be silent: a canvas skipped because it has no code actors is
      // fine, one skipped because its runtime is too small is something to act on.
      if (result.skipped.length) {
        process.stdout.write(`\n${result.skipped.length} canvas(es) skipped: ${result.skipped.map((s) => `${s.canvasId} (${s.reason})`).join(', ')}\n`);
      }
      return;
    }

    const status = await client.getWorkspaceDeployment(ctx.org, ctx.workspace);
    if (globalOpts.json) {
      output(status, globalOpts);
      return;
    }
    output(
      status.canvases.map((canvas) => ({
        slug: canvas.slug,
        codeActorCount: canvas.codeActorCount,
        running: canvas.activeBuild ? canvas.activeBuild.status : '—',
        latest: canvas.latestBuild ? canvas.latestBuild.status : '—',
        state: canvas.outdated
          ? 'outdated'
          : canvas.buildable
            ? 'up to date'
            : (canvas.blockedReason ?? 'not buildable'),
      })),
      globalOpts,
      {
        columns: [
          { key: 'slug', header: 'CANVAS' },
          { key: 'codeActorCount', header: 'CODE ACTORS' },
          { key: 'running', header: 'RUNNING' },
          { key: 'latest', header: 'LATEST' },
          { key: 'state', header: 'STATE' },
        ],
        title: `Deployment — ${status.isDeployed ? 'ON' : 'OFF'}`,
      },
    );
  } catch (error) {
    handleError(error);
  }
};
