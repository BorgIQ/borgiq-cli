import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsList = async (canvasId: string, options: { page?: string; pageSize?: string; search?: string; actorType?: string; isActive?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listCanvasActors(ctx.org, ctx.workspace, canvasId, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
      search: options.search,
      actorType: options.actorType,
      isActive: options.isActive,
    });

    // Transform { total, actors } to { total, data } for the output helper
    output({ total: result.total, data: result.actors }, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'type', header: 'TYPE' },
        { key: 'isActive', header: 'ACTIVE' },
        { key: 'msgVar', header: 'MSG VAR' },
      ],
      title: 'Canvas Actors',
    });
  } catch (error) {
    handleError(error);
  }
};
