import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { workspacesList } from './list.js';

export const registerWorkspacesCommands = (program: Command): void => {
  const workspaces = program.command('workspaces').description('Manage workspaces');

  withListOptions(workspaces.command('list').description('List workspaces in an organization'), {
    sortFields: ['name', 'createdAt', 'updatedAt'],
    defaultSortBy: 'name',
    defaultSortOrder: 'asc',
  })
    .action(workspacesList);
};
