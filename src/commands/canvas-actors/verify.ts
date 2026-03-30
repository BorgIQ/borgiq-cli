import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readJsonInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasActorsVerify = async (canvasId: string, options: { file?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readJsonInput(options.file);
    const result = await client.verifyCanvasActor(ctx.org, ctx.workspace, canvasId, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      if (result.valid) {
        process.stderr.write('Actor options are valid.\n');
      } else {
        process.stderr.write(`Validation failed with ${result.errors.length} error(s).\n`);
      }
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
