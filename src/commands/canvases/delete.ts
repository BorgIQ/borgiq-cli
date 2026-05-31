import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';

export const canvasesDelete = async (
  id: string,
  options: { yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await confirmDestructive(`Delete canvas ${id}? This cannot be undone.`, options);
    await client.deleteCanvas(ctx.org, ctx.workspace, id);
    process.stderr.write(`Canvas deleted: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
