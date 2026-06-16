import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';

export const canvasActorsDelete = async (
  canvasSlugOrId: string,
  actorId: string,
  options: { editVersion?: string; yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await confirmDestructive(`Delete actor ${actorId} from canvas ${canvasSlugOrId}? This cannot be undone.`, options);
    const editVersion = options.editVersion ? parseInt(options.editVersion, 10) : undefined;
    await client.deleteCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId, editVersion);
    process.stderr.write(`Actor deleted: ${actorId}\n`);
  } catch (error) {
    handleError(error);
  }
};
