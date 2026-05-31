import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

export const canvasesList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await collectAllPages(options, (params) => client.listCanvases(ctx.org, ctx.workspace, params));

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'slug', header: 'SLUG' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Canvases',
    });
  } catch (error) {
    handleError(error);
  }
};
