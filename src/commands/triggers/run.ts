import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const triggersRun = async (options: { canvasId: string; actorId: string; data?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    let data: Record<string, unknown> | undefined;
    if (options.data) {
      try {
        data = JSON.parse(options.data) as Record<string, unknown>;
      } catch {
        process.stderr.write('Error: --data must be valid JSON.\n');
        process.exit(1);
      }
    }

    const result = await client.triggerManual(ctx.org, ctx.workspace, {
      canvasId: options.canvasId,
      actorId: options.actorId,
      data,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Flow triggered successfully.\n');
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
