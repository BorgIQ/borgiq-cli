import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { tokensList } from './list.js';
import { tokensCreate } from './create.js';
import { tokensRevoke } from './revoke.js';

export const registerTokensCommands = (program: Command): void => {
  const tokens = program.command('tokens').description('Manage API tokens');

  withListOptions(tokens.command('list').description('List API tokens'), {
    sort: { fields: ['name', 'createdAt'], defaultBy: 'createdAt', defaultOrder: 'desc' },
  })
    .action(tokensList);

  tokens
    .command('create')
    .description('Create a new API token. Prompts interactively when required flags are missing.')
    .option('--name <name>', 'Token name')
    .option('--scopes <scopes>', 'Comma-separated list of scopes')
    .option('--expires-at <date>', 'Expiration date (ISO 8601)')
    .action(tokensCreate);

  tokens
    .command('revoke <id>')
    .description('Revoke an API token')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(tokensRevoke);
};
