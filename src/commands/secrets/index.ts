import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { secretsList } from './list.js';
import { secretsDelete } from './delete.js';
import { secretsCreate } from './create.js';

export const registerSecretsCommands = (program: Command): void => {
  const secrets = program.command('secrets').description('Manage secrets');

  withListOptions(secrets.command('list').description('List secrets'), {
    sort: { fields: ['key', 'createdAt'], defaultBy: 'key', defaultOrder: 'asc' },
  })
    .action(secretsList);

  secrets
    .command('create')
    .description('Create a secret (client-side encrypted). Prompts interactively when flags are missing.')
    .option('--key <key>', 'Secret key (unique within workspace)')
    .option('--type <type>', 'Secret type: plainText | jwt')
    .option('--description <desc>', 'Secret description')
    .option('--exposure-mode <mode>', 'Exposure mode: httpOnly or exposed', 'httpOnly')
    .option('--data <data>', 'Inline secret data (for single-string types)')
    .option('--data-file <path>', 'Path to JSON/YAML file with secret data')
    .action(secretsCreate);

  secrets
    .command('delete <id>')
    .description('Delete a secret')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(secretsDelete);
};
