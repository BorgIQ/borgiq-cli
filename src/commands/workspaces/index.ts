import type { Command } from 'commander';

import { workspacesList } from './list.js';

export const registerWorkspacesCommands = (program: Command): void => {
  const workspaces = program.command('workspaces').description('Manage workspaces');

  workspaces
    .command('list')
    .description('List workspaces in an organization')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(workspacesList);
};
