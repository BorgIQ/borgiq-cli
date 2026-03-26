import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunJobsRuntimeData = async (jobId: string, options: { rootPath?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.getJobRuntimeData(ctx.org, ctx.workspace, jobId, options.rootPath);
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
