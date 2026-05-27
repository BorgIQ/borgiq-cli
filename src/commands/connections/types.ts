import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

export const connectionsTypes = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listConnectionTypes(ctx.org, ctx.workspace, parseListOptions(options));

    output(result, globalOpts, {
      columns: [
        { key: 'name', header: 'TYPE' },
        { key: 'title', header: 'TITLE' },
        { key: 'authType', header: 'AUTH' },
      ],
      title: 'Connection Types',
    });
  } catch (error) {
    handleError(error);
  }
};
