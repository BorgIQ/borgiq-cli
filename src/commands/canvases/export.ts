import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { formatJson } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesExport = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const data = await client.exportCanvas(ctx.org, ctx.workspace, id);
    formatJson(data);
  } catch (error) {
    handleError(error);
  }
};
