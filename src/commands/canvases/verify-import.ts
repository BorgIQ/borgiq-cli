import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readJsonInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesVerifyImport = async (options: { file?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readJsonInput(options.file);
    const result = await client.verifyImportData(ctx.org, ctx.workspace, body);

    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
