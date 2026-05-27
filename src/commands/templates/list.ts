import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import type { BIQActorTemplateType } from '../../client/types.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

interface TemplatesListOptions extends ListOptionFlags {
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

    const { page, pageSize, search, sortBy, sortOrder } = parseListOptions(options);
    const result = await client.listTemplates(ctx.org, ctx.workspace, {
      page, pageSize, search, sortBy, sortOrder,
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
