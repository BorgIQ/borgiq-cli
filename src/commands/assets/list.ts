import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

export const assetsList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listAssets(ctx.org, ctx.workspace, parseListOptions(options));

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'key', header: 'KEY' },
        { key: 'type', header: 'TYPE' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Assets',
    });
  } catch (error) {
    handleError(error);
  }
};
