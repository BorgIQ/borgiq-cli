import type { Command } from 'commander';

import { connectionsList } from './list.js';
import { connectionsDelete } from './delete.js';
import { connectionsTypes } from './types.js';

export const registerConnectionsCommands = (program: Command): void => {
  const connections = program.command('connections').description('Manage connections');

  connections
    .command('list')
    .description('List connections')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(connectionsList);

  connections
    .command('types')
    .description('List available connection types')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(connectionsTypes);

  connections
    .command('delete <id>')
    .description('Delete a connection')
    .action(connectionsDelete);
};
