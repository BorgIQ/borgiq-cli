import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { prompt, promptRequired } from '../../lib/prompt.js';
import { readInput } from '../../lib/input.js';
import { parseCatalogFlags, resolveConnectionId } from './shared.js';

interface CreateOptions {
  provider?: string;
  name?: string;
  connection?: string;
  models?: string;
  modelsFile?: string;
  dataFile?: string;
}

export const aiProvidersCreate = async (options: CreateOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const isTty = process.stdin.isTTY;

    const provider = options.provider || (isTty ? await promptRequired('Provider (e.g. custom, openai, anthropic)') : undefined);
    if (!provider) {
      throw new CliUsageError('--provider is required when not running interactively.');
    }

    // A custom provider's name is its slug (actors reference its models as <slug>/<model-id>);
    // a built-in provider's name is the provider id.
    const name = options.name || (isTty ? await prompt(provider === 'custom' ? 'Name (slug, e.g. fireworks)' : 'Name', provider) : provider);
    if (!name) {
      throw new CliUsageError('--name is required for a custom provider when not running interactively.');
    }

    const connectionKey = options.connection ?? (isTty ? await prompt('Connection key or id (optional)') : undefined);
    const connectionId = connectionKey ? await resolveConnectionId(client, ctx, connectionKey) : undefined;

    if (options.dataFile && (options.models !== undefined || options.modelsFile)) {
      throw new CliUsageError('--data-file replaces the whole data object; do not combine it with --models or --models-file.');
    }
    let data: unknown = {};
    if (options.dataFile) {
      data = await readInput(options.dataFile);
    } else {
      const models = await parseCatalogFlags(options)
        ?? (isTty && provider === 'custom' ? await promptModels() : undefined);
      if (models) data = { models };
    }

    const form = new FormData();
    form.append('name', name);
    form.append('provider', provider);
    if (connectionId) form.append('connectionId', connectionId);
    form.append('data', JSON.stringify(data ?? {}));

    const setting = await client.createAiSettingMultipart(ctx.org, ctx.workspace, form);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`AI provider created: ${setting.name} (${setting.id})\n`);
    }
    output(setting, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

const promptModels = async (): Promise<{ id: string }[] | undefined> => {
  const answer = await prompt('Model ids, comma-separated (optional)');
  const ids = answer.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return ids.length > 0 ? ids.map((id) => ({ id })) : undefined;
};
