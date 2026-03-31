import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunsList = async (options: { page?: string; pageSize?: string; canvasId: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listFlowruns(ctx.org, ctx.workspace, options.canvasId, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'state', header: 'STATE' },
        { key: 'canvasName', header: 'CANVAS' },
        { key: 'createdAt', header: 'CREATED' },
      ],
      title: 'Flow Runs',
    });
  } catch (error) {
    handleError(error);
  }
};
