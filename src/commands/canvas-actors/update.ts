import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsUpdate = async (canvasId: string, actorId: string, options: { file?: string; editVersion?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readInput(options.file);
    const editVersion = options.editVersion ? parseInt(options.editVersion, 10) : undefined;
    const result = await client.updateCanvasActor(ctx.org, ctx.workspace, canvasId, actorId, body, editVersion);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Actor updated: ${actorId}\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
