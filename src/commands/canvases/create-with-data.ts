import { applyCanvasAutoLayout, canvasSlugOrIdFromCreateResult, shouldAutoLayout } from '../../lib/canvasLayout.js';
import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { output } from '../../output/index.js';

export const canvasesCreateWithData = async (
  options: { file?: string; autoLayout?: boolean; layoutSourceActorId?: string[] },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readInput(options.file);
    const result = await client.createCanvasWithData(ctx.org, ctx.workspace, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Canvas created with data.\n');
    }
    if (shouldAutoLayout(options)) {
      const canvasTarget = canvasSlugOrIdFromCreateResult(result, body);
      if (!canvasTarget) {
        throw new CliUsageError('Cannot auto-layout created canvas because no canvas slug or ID was returned. Include a canvas slug in the input or run `borgiq canvases layout <canvas>` manually.');
      }
      const layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, canvasTarget, options, globalOpts);
      output({ canvas: result, layout }, globalOpts);
      return;
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
