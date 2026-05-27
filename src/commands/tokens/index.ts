import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { tokensList } from './list.js';
import { tokensCreate } from './create.js';
import { tokensRevoke } from './revoke.js';

export const registerTokensCommands = (program: Command): void => {
  const tokens = program.command('tokens').description('Manage API tokens');

  withListOptions(tokens.command('list').description('List API tokens'), {
    sortFields: ['name', 'createdAt'],
    defaultSortBy: 'createdAt',
    defaultSortOrder: 'desc',
  })
    .action(tokensList);

  tokens
    .command('create')
    .description('Create a new API token')
    .requiredOption('--name <name>', 'Token name')
    .requiredOption('--scopes <scopes>', 'Comma-separated list of scopes')
    .option('--expires-at <date>', 'Expiration date (ISO 8601)')
    .action(tokensCreate);

  tokens
    .command('revoke <id>')
    .description('Revoke an API token')
    .action(tokensRevoke);
};
