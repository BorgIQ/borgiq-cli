import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesLayout = async (id: string, options: { sourceActorId?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.layoutCanvas(ctx.org, ctx.workspace, id, options.sourceActorId);

    if (!globalOpts.json && process.stderr.isTTY) {
      const actorCount = Object.keys(result.actors || {}).length;
      process.stderr.write(`Layout applied: ${actorCount} actors repositioned.\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
