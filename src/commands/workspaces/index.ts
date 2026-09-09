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
    .option('--enable', 'Deploy the workspace: every run executes each canvas\'s active runtime build')
    .option('--disable', 'Undeploy: runs execute each canvas\'s current code')
    .addHelpText(
      'after',
      `
On a deployed workspace, every run of a canvas — triggers and editor test runs alike — executes the
canvas's active runtime build: a snapshot of the canvas whose code actors were compiled and had
their dependencies installed ahead of time. Actors start faster, and every run of a canvas executes
the same code.

What that means day to day:
  - Edits reach runs only after the next build finishes.
  - A canvas with no fully successful build refuses every run until it is built.
  - Canvases build one at a time: 'borgiq canvases runtime-build <canvas>' or
    'borgiq bundle build <dir>' (which pushes first).

Examples:
  $ borgiq workspaces deployment
  $ borgiq workspaces deployment --enable
  $ borgiq workspaces deployment --json
`,
    )
    .action(workspacesDeployment);
};
