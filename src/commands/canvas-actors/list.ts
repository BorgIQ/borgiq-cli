import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

interface CanvasActorsListOptions extends ListOptionFlags {
  actorType?: string;
  isActive?: string;
}

export const canvasActorsList = async (canvasId: string, options: CanvasActorsListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // The API returns { total, actors }; normalize to { total, data } so the
    // pagination helper and output layer can treat it like every other list.
    const result = await collectAllPages(options, (params) =>
      client
        .listCanvasActors(ctx.org, ctx.workspace, canvasId, {
          ...params,
          actorType: options.actorType,
          isActive: options.isActive,
        })
        .then((r) => ({ total: r.total, data: r.actors })),
    );

    output(result, globalOpts, {
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
