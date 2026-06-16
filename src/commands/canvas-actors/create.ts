import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsCreate = async (canvasSlugOrId: string, actorId: string, options: { file?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readInput(options.file);
    const result = await client.createCanvasActor(ctx.org, ctx.workspace, canvasSlugOrId, actorId, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Actor created: ${actorId}\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
