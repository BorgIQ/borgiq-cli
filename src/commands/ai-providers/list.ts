import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { catalogOf } from './shared.js';

interface ListOptions {
  provider?: string;
}

export const aiProvidersList = async (options: ListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const settings = await client.listAiSettings(ctx.org, ctx.workspace);
    const rows = settings
      .filter((s) => !options.provider || s.provider === options.provider)
      .map((s) => ({ ...s, models: catalogOf(s).length }));

    output(rows, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'provider', header: 'PROVIDER' },
        { key: 'connectionId', header: 'CONNECTION' },
        { key: 'models', header: 'MODELS' },
        { key: 'updatedAt', header: 'UPDATED' },
      ],
      title: 'AI providers',
    });
  } catch (error) {
    handleError(error);
  }
};
