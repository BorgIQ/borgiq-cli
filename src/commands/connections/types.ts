import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const connectionsTypes = async (options: { page?: string; pageSize?: string; search?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listConnectionTypes(ctx.org, ctx.workspace, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
      search: options.search,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'name', header: 'TYPE' },
        { key: 'title', header: 'TITLE' },
      ],
      title: 'Connection Types',
    });
  } catch (error) {
    handleError(error);
  }
};
