import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesUpdateData = async (id: string, options: { file?: string; mode?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvas = await readInput(options.file);
    const mode = (options.mode || 'merge') as 'merge' | 'insert' | 'replace';
    const result = await client.importCanvasData(ctx.org, ctx.workspace, id, { canvas, mode });

    if (!globalOpts.json && process.stderr.isTTY) {
      const applied = (result as { appliedOperations?: unknown[] })?.appliedOperations?.length ?? 0;
      const conflicts = (result as { conflicts?: unknown[] })?.conflicts?.length ?? 0;
      process.stderr.write(`Import complete (${mode} mode): ${applied} operations applied, ${conflicts} conflicts.\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
