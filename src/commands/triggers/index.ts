import type { Command } from 'commander';

import { withCanvasOption } from '../../lib/canvasFlag.js';
import { triggersRun } from './run.js';

export const registerTriggersCommands = (program: Command): void => {
  const triggers = program.command('triggers').description('Manage triggers');

  withCanvasOption(triggers.command('run').description('Manually trigger a flow'), 'Canvas ID (ULID); slug is not accepted by this endpoint')
    .requiredOption('--actor-id <id>', 'Trigger actor ID')
    .action(triggersRun);
};
