import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

interface CanvasActorsListOptions extends ListOptionFlags {
  actorType?: string;
  isActive?: string;
}

export const canvasActorsList = async (canvasId: string, options: CanvasActorsListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listCanvasActors(ctx.org, ctx.workspace, canvasId, {
      ...parseListOptions(options),
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
