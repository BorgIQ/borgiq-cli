import type { Command } from 'commander';

import { orgsList } from './list.js';

export const registerOrgsCommands = (program: Command): void => {
  const orgs = program.command('orgs').description('Manage organizations');

  orgs
    .command('list')
    .description('List organizations and workspaces')
    .action(orgsList);
};
