import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const templatesGet = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const template = await client.getTemplate(ctx.org, ctx.workspace, id);
    output(template, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
