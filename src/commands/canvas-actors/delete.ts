import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsDelete = async (canvasId: string, actorId: string, options: { editVersion?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const editVersion = options.editVersion ? parseInt(options.editVersion, 10) : undefined;
    await client.deleteCanvasActor(ctx.org, ctx.workspace, canvasId, actorId, editVersion);
    process.stderr.write(`Actor deleted: ${actorId}\n`);
  } catch (error) {
    handleError(error);
  }
};
