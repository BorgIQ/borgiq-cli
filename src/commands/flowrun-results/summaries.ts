import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunResultsSummaries = async (options: { jobId: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.getJobResultSummaries(ctx.org, ctx.workspace, options.jobId);

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'status', header: 'STATUS' },
        { key: 'startedAt', header: 'STARTED' },
        { key: 'endedAt', header: 'ENDED' },
      ],
      title: 'Job Result Summaries',
    });
  } catch (error) {
    handleError(error);
  }
};
