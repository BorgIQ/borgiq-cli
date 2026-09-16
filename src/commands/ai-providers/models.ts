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

    // An empty result for a named provider is more often a typo than a provider without models.
    if (options.provider && !models.some((m) => m.provider === options.provider)) {
      process.stderr.write(`No provider named '${options.provider}'. Run \`borgiq ai-providers list\` to see the configured providers.\n`);
    }

    output(rows, globalOpts, {
      columns: [
        { key: 'ref', header: 'REF' },
        { key: 'label', header: 'LABEL' },
        { key: 'provider', header: 'PROVIDER' },
        { key: 'group', header: 'GROUP' },
        { key: 'custom', header: 'CUSTOM' },
        { key: 'agent', header: 'AGENT' },
      ],
      title: 'AI models',
    });
  } catch (error) {
    handleError(error);
  }
};
