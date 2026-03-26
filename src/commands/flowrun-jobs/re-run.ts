import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunJobsReRun = async (options: { jobId: string; publish?: boolean }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.reRunJob(ctx.org, ctx.workspace, {
      flowrunJobId: options.jobId,
      publishEmittedMessagesToConnectedActors: options.publish ?? true,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Job re-run started.\n');
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
