import type { Command } from 'commander';

import { triggersRun } from './run.js';

export const registerTriggersCommands = (program: Command): void => {
  const triggers = program.command('triggers').description('Manage triggers');

  triggers
    .command('run')
    .description('Manually trigger a flow')
    .requiredOption('--canvas-id <id>', 'Canvas ID')
    .requiredOption('--actor-id <id>', 'Trigger actor ID')
    .action(triggersRun);
};
