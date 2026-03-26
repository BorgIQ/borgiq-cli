import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesCreate = async (options: { name: string; slug: string; description?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvas = await client.createCanvas(ctx.org, ctx.workspace, {
      name: options.name,
      slug: options.slug,
      description: options.description,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Canvas created: ${canvas.name} (${canvas.id})\n`);
    }
    output(canvas, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
