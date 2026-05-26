import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import type { BIQActorTemplateType } from '../../client/types.js';

interface TemplatesListOptions {
  page?: string;
  pageSize?: string;
  search?: string;
  type?: string[];
  appId?: string;
}

export const templatesList = async (options: TemplatesListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const types = options.type?.map((t) => t.toUpperCase() as BIQActorTemplateType);
    if (types?.some((t) => t !== 'TASK' && t !== 'TRIGGER')) {
      throw new Error('--type must be one of: TASK, TRIGGER');
    }

    const result = await client.listTemplates(ctx.org, ctx.workspace, {
      page: options.page ? parseInt(options.page, 10) : undefined,
      pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
      search: options.search,
      types,
      appId: options.appId,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'type', header: 'TYPE' },
        { key: 'appName', header: 'APP' },
        { key: 'accessLevel', header: 'ACCESS' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Templates',
    });
  } catch (error) {
    handleError(error);
  }
};
