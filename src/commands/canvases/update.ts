import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesUpdate = async (id: string, options: { name?: string; slug?: string; description?: string; tags?: string; messageTtl?: string; runtimeSlug?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body: { name?: string; slug?: string; description?: string; tags?: string; messageTTLInDays?: number; runtimeSlug?: string } = {};
    if (options.name) body.name = options.name;
    if (options.slug) body.slug = options.slug;
    if (options.description) body.description = options.description;
    if (options.tags) body.tags = options.tags;
    if (options.messageTtl) body.messageTTLInDays = parseInt(options.messageTtl, 10);
    if (options.runtimeSlug) body.runtimeSlug = options.runtimeSlug;

    const canvas = await client.updateCanvas(ctx.org, ctx.workspace, id, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Canvas updated: ${canvas.name}\n`);
    }
    output(canvas, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
