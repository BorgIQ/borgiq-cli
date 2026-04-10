import type { Command } from 'commander';

import { secretsList } from './list.js';
import { secretsDelete } from './delete.js';
import { secretsCreate } from './create.js';

export const registerSecretsCommands = (program: Command): void => {
  const secrets = program.command('secrets').description('Manage secrets');

  secrets
    .command('list')
    .description('List secrets')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(secretsList);

  secrets
    .command('create')
    .description('Create a secret (client-side encrypted). Prompts interactively when flags are missing.')
    .option('--key <key>', 'Secret key (unique within workspace)')
    .option('--type <type>', 'Secret type: plainText | json | yaml | jwt | basic | apiKey | bearer | awsRoleBased | custom')
    .option('--description <desc>', 'Secret description')
    .option('--exposure-mode <mode>', 'Exposure mode: HttpOnly or Protected', 'HttpOnly')
    .option('--data <data>', 'Inline secret data (for single-string types)')
    .option('--data-file <path>', 'Path to JSON/YAML file with secret data')
    .action(secretsCreate);

  secrets
    .command('delete <id>')
    .description('Delete a secret')
    .action(secretsDelete);
};
