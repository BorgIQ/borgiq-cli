import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesValidate = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.validateCanvas(ctx.org, ctx.workspace, id);

    if (!globalOpts.json && process.stderr.isTTY) {
      if (result.valid) {
        process.stderr.write('Canvas is valid.\n');
      } else {
        process.stderr.write(`Canvas has ${result.errors.length} error(s) and ${result.warnings.length} warning(s).\n`);
      }
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
