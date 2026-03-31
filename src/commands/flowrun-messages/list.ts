import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunMessagesList = async (options: { page?: string; pageSize?: string; canvasId: string; flowrunId?: string; actorId: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listFlowrunMessages(ctx.org, ctx.workspace, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
      canvasId: options.canvasId,
      flowrunId: options.flowrunId,
      actorId: options.actorId,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'actorId', header: 'ACTOR' },
        { key: 'portId', header: 'PORT' },
        { key: 'createdAt', header: 'CREATED' },
      ],
      title: 'Flow Run Messages',
    });
  } catch (error) {
    handleError(error);
  }
};
