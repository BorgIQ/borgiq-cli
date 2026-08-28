import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { workspacesList } from './list.js';
import { workspacesDeployment } from './deployment.js';

export const registerWorkspacesCommands = (program: Command): void => {
  const workspaces = program.command('workspaces').description('Manage workspaces');

  withListOptions(workspaces.command('list').description('List workspaces in an organization'), {
    sort: { fields: ['name', 'createdAt', 'updatedAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .action(workspacesList);

  workspaces
    .command('deployment')
    .description('Show or change whether this workspace is deployed')
    .option('--enable', 'Deploy the workspace: triggers run each canvas\'s active runtime build')
    .option('--disable', 'Undeploy: triggers run each canvas\'s current code')
    .option('--build-all', 'Start a runtime build for every buildable canvas')
    .addHelpText(
      'after',
      `
A deployed workspace's triggers run each canvas's active runtime build — a snapshot of the canvas
whose code actors were compiled and had their dependencies installed ahead of time. Actors start
faster, and every run of a canvas executes the same code.

What that means day to day:
  - Edits reach triggers only after the next build finishes.
  - Test runs from the editor always use your current code.
  - A canvas with no build, or whose build failed, keeps running its current code.

Examples:
  $ borgiq workspaces deployment
  $ borgiq workspaces deployment --enable --build-all
  $ borgiq workspaces deployment --json
`,
    )
    .action(workspacesDeployment);
};
