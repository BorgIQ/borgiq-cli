import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunJobsList = async (options: { page?: string; pageSize?: string; canvasId: string; actorId: string; flowrunId?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listFlowrunJobs(ctx.org, ctx.workspace, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
      canvasId: options.canvasId,
      actorId: options.actorId,
      flowrunId: options.flowrunId,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'state', header: 'STATE' },
        { key: 'flowrunId', header: 'FLOWRUN' },
        { key: 'createdAt', header: 'CREATED' },
      ],
      title: 'Flow Run Jobs',
    });
  } catch (error) {
    handleError(error);
  }
};
