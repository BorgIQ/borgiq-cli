import type { Command } from 'commander';

import { aiProvidersList } from './list.js';
import { aiProvidersCreate } from './create.js';
import { aiProvidersEdit } from './edit.js';
import { aiProvidersDelete } from './delete.js';
import { aiProvidersModels } from './models.js';

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export const registerAiProvidersCommands = (program: Command): void => {
  const aiProviders = program
    .command('ai-providers')
    .description('Manage the workspace AI providers (built-in provider credentials and custom OpenAI-compatible providers) and list usable models');

  aiProviders
    .command('list')
    .description('List the workspace AI providers')
    .option('--provider <provider>', 'Only settings of this provider (e.g. custom, openai)')
    .action(aiProvidersList);

  aiProviders
    .command('models')
    .description('List the model references usable in actors: known built-in model ids, and every custom provider\'s catalog as <slug>/<model-id>. Actors also accept <provider>/<model-id> for a built-in provider\'s unlisted models. The AGENT column says whether a model may drive an AI Agent actor.')
    .option('--custom', 'Only models from custom providers')
    .option('--provider <provider>', 'Only models of this provider id or custom provider slug (a hint is printed when none matches)')
    .action(aiProvidersModels);

  aiProviders
    .command('create')
    .description('Add an AI provider. A custom provider (--provider custom) needs a slug (--name), a connection for the key (a vendor type such as groq-bearer, a generic bearer/API-key connection, or custom-provider-apikey) and a base URL (--base-url, unless the connection supplies one); its models are referenced as <slug>/<model-id>.')
    .option('--provider <provider>', 'Provider id: custom, or a built-in provider (openai, anthropic, google, xai, ...)')
    .option('--name <name>', 'Custom provider slug, required for --provider custom: lowercase letters, digits and dashes, starting alphanumeric, at most 40 characters, not a built-in provider id (e.g. fireworks). Built-in providers default to the provider id.')
    .option('--connection <key-or-id>', 'Connection key or id providing the credential (custom providers: an AI vendor connection type, a generic bearer/API-key connection, or custom-provider-apikey)')
    .option('--base-url <url>', 'Custom providers only: the OpenAI-compatible base URL, overriding the connection\'s and the vendor default')
    .option('--models <ids>', 'Custom providers only: comma-separated model ids for the catalog')
    .option('--models-file <path>', 'Custom providers only: JSON/YAML file with catalog entries ([{ id, label?, agent?, costPerMTokens?, ... }] or { models: [...] })')
    .option('--data-file <path>', 'JSON/YAML file replacing the whole non-secret data object')
    .action(aiProvidersCreate);

  aiProviders
    .command('edit <id-or-name>')
    .description('Update an AI provider: rename a custom provider, change its connection or base URL, or edit its model catalog. With no flags nothing is sent. Renaming warns about the canvases whose <slug>/<model-id> references stop resolving.')
    .option('--name <name>', 'New slug (custom providers only; same rule as create --name)')
    .option('--connection <key-or-id>', 'Connection key or id')
    .option('--no-connection', 'Remove the connection')
    .option('--base-url <url>', 'Custom providers only: set the base URL override')
    .option('--no-base-url', 'Custom providers only: remove the base URL override (the connection\'s or the vendor default applies again)')
    .option('--models <ids>', 'Custom providers only: replace the catalog with these comma-separated model ids')
    .option('--models-file <path>', 'Custom providers only: replace the catalog with the entries in this JSON/YAML file')
    .option('--add-model <id>', 'Custom providers only: add a model id to the catalog (repeatable, comma-separated allowed)', collect)
    .option('--remove-model <id>', 'Custom providers only: remove a model id from the catalog (repeatable, comma-separated allowed)', collect)
    .option('--data-file <path>', 'JSON/YAML file replacing the whole non-secret data object')
    .action(aiProvidersEdit);

  aiProviders
    .command('delete <id-or-name>')
    .description('Delete an AI provider. Warns about the canvases whose <slug>/<model-id> references stop resolving before asking for confirmation.')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(aiProvidersDelete);
};
