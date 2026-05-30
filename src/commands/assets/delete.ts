import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';

export const assetsDelete = async (
  id: string,
  options: { yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await confirmDestructive(`Delete asset ${id}? This cannot be undone.`, options);
    await client.deleteAsset(ctx.org, ctx.workspace, id);
    process.stderr.write(`Asset deleted: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
