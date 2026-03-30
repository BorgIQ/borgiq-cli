import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readJsonInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsCreate = async (canvasId: string, actorId: string, options: { file?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readJsonInput(options.file);
    const result = await client.createCanvasActor(ctx.org, ctx.workspace, canvasId, actorId, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Actor created: ${actorId}\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
