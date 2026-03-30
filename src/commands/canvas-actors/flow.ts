import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsFlow = async (canvasId: string, actorId: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.getCanvasActorFlow(ctx.org, ctx.workspace, canvasId, actorId);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Flow from ${actorId}: ${result.actorCount} actor(s)\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
