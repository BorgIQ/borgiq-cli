import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsGet = async (canvasSlugOrId: string, actorId: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const actor = await client.getCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId);
    output(actor, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
