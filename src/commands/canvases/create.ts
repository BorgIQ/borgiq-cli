import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { promptRequired } from '../../lib/prompt.js';

export const canvasesCreate = async (options: { name?: string; slug?: string; description?: string; messageTtl: string; tags?: string; runtimeSlug?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const isTty = process.stdin.isTTY;

    const name = options.name || (isTty ? await promptRequired('Canvas name') : undefined);
    if (!name) throw new CliUsageError('--name is required when not running interactively.');

    const slug = options.slug || (isTty ? await promptRequired('Canvas slug') : undefined);
    if (!slug) throw new CliUsageError('--slug is required when not running interactively.');

    const canvas = await client.createCanvas(ctx.org, ctx.workspace, {
      name,
      slug,
      description: options.description,
      messageTTLInDays: parseInt(options.messageTtl, 10),
      tags: options.tags,
      runtimeSlug: options.runtimeSlug,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Canvas created: ${canvas.name} (${canvas.id})\n`);
    }
    output(canvas, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
