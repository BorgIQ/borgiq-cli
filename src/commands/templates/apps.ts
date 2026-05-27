import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

interface TemplateAppsOptions extends ListOptionFlags {
  categoryId?: string;
}

export const templatesApps = async (options: TemplateAppsOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.listTemplateApps(ctx.org, ctx.workspace, {
      ...parseListOptions(options),
      categoryId: options.categoryId,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'color', header: 'COLOR' },
        { key: 'icon', header: 'ICON' },
      ],
      title: 'Template Apps',
    });
  } catch (error) {
    handleError(error);
  }
};
