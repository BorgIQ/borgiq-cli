import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesGet = async (id: string, options: { includeData?: boolean }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvas = await client.getCanvas(ctx.org, ctx.workspace, id, options.includeData);
    output(canvas, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
