import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const triggersRun = async (options: { canvasId: string; actorId: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.triggerManual(ctx.org, ctx.workspace, {
      canvasId: options.canvasId,
      actorId: options.actorId,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Flow triggered successfully.\n');
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
