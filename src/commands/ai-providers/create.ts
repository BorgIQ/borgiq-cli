import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { prompt, promptRequired } from '../../lib/prompt.js';
import { readInput } from '../../lib/input.js';
import { catalogOf, parseCatalogFlags, resolveConnectionId, validateBaseUrl } from './shared.js';

interface CreateOptions {
  provider?: string;
  name?: string;
  connection?: string;
  baseUrl?: string;
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
    const isCustom = provider === 'custom';

    // The base URL and the model catalog are parts of a custom provider; a built-in provider's
    // setting only links a connection, so these flags would be stored and ignored.
    if (!isCustom) {
      const customOnly: [unknown, string][] = [
        [options.baseUrl, '--base-url'],
        [options.models, '--models'],
        [options.modelsFile, '--models-file'],
      ];
      const offending = customOnly.find(([value]) => value !== undefined)?.[1];
      if (offending) {
        throw new CliUsageError(`${offending} applies to custom providers only (--provider custom); a built-in provider '${provider}' has no base URL or model catalog of its own.`);
      }
    }
    if (options.dataFile && (options.models !== undefined || options.modelsFile || options.baseUrl !== undefined)) {
      throw new CliUsageError('--data-file replaces the whole data object; do not combine it with --models, --models-file or --base-url.');
    }

    // A custom provider's name is its slug (actors reference its models as <slug>/<model-id>), so it
    // has no default; a built-in provider's name defaults to the provider id.
    let name: string;
    if (isCustom) {
      const given = options.name || (isTty ? await promptRequired('Name (slug, e.g. fireworks)') : undefined);
      if (!given) {
        throw new CliUsageError('--name is required for a custom provider.');
      }
      name = given;
    } else {
      name = options.name || (isTty ? await prompt('Name', provider) : provider);
    }

    const connectionKey = options.connection ?? (isTty ? await prompt('Connection key or id (optional)') : undefined);
    const connectionId = connectionKey ? await resolveConnectionId(client, ctx, connectionKey) : undefined;

    let data: unknown = {};
    if (options.dataFile) {
      data = await readInput(options.dataFile);
    } else {
      const models = await parseCatalogFlags(options)
        ?? (isTty && isCustom ? await promptModels() : undefined);
      // the base URL override: the connection's own base URL or the vendor default applies without it
      const baseURL = options.baseUrl !== undefined ? validateBaseUrl(options.baseUrl) : undefined;
      data = { ...(baseURL ? { baseURL } : {}), ...(models ? { models } : {}) };
    }

    const form = new FormData();
    form.append('name', name);
    form.append('provider', provider);
    if (connectionId) form.append('connectionId', connectionId);
    form.append('data', JSON.stringify(data ?? {}));

    const setting = await client.createAiSettingMultipart(ctx.org, ctx.workspace, form);

    // Only once the provider exists: a rejected create should print the error alone
    if (isCustom && !isTty && catalogOf({ data }).length === 0) {
      process.stderr.write(`Warning: custom provider '${name}' has no models; actors cannot use it until its catalog is filled (\`borgiq ai-providers edit ${name} --add-model <model-id>\`).\n`);
    }

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
