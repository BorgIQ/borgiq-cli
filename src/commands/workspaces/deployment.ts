import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';

interface DeploymentOptions {
  enable?: boolean;
  disable?: boolean;
}

/**
 * Show or change whether a workspace is deployed.
 *
 * On a deployed workspace, EVERY run of a canvas — triggers and editor test runs alike — executes
 * the canvas's active runtime build (a snapshot of the canvas whose code actors were compiled and
 * had their dependencies installed ahead of time), never the canvas's current code. Edits reach runs
 * only after the next build, and a canvas with no fully successful build refuses runs. Canvases
 * build one at a time: `borgiq canvases runtime-build <canvas>`, or the Build button in the canvas
 * editor.
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
