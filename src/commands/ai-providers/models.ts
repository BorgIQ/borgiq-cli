import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

interface ModelsOptions {
  custom?: boolean;
  provider?: string;
}

export const aiProvidersModels = async (options: ModelsOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const { models } = await client.listAiModels(ctx.org, ctx.workspace);
    const rows = models
      .filter((m) => !options.custom || m.custom)
      .filter((m) => !options.provider || m.provider === options.provider);

    output(rows, globalOpts, {
      columns: [
        { key: 'ref', header: 'REF' },
        { key: 'label', header: 'LABEL' },
        { key: 'provider', header: 'PROVIDER' },
        { key: 'group', header: 'GROUP' },
        { key: 'custom', header: 'CUSTOM' },
      ],
      title: 'AI models',
    });
  } catch (error) {
    handleError(error);
  }
};
