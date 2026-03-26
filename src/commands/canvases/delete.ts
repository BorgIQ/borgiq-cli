import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';

export const canvasesDelete = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await client.deleteCanvas(ctx.org, ctx.workspace, id);
    process.stderr.write(`Canvas deleted: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
