import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunJobsTestRun = async (options: { canvasId: string; actorId: string; publish?: boolean }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.testRunJob(ctx.org, ctx.workspace, {
      canvasId: options.canvasId,
      actorId: options.actorId,
      publishEmittedMessageToConnectedActors: options.publish ?? false,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Test run started.\n');
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
