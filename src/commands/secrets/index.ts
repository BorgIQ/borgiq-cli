import type { Command } from 'commander';

import { secretsList } from './list.js';
import { secretsDelete } from './delete.js';

export const registerSecretsCommands = (program: Command): void => {
  const secrets = program.command('secrets').description('Manage secrets');

  secrets
    .command('list')
    .description('List secrets')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(secretsList);

  secrets
    .command('delete <id>')
    .description('Delete a secret')
    .action(secretsDelete);
};
