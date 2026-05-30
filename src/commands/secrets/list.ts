import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

export const secretsList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await collectAllPages(options, (params) => client.listSecrets(ctx.org, ctx.workspace, params));

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'key', header: 'KEY' },
        { key: 'type', header: 'TYPE' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Secrets',
    });
  } catch (error) {
    handleError(error);
  }
};
