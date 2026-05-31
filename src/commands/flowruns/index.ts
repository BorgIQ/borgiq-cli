import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { flowrunsList } from './list.js';
import { flowrunsGet } from './get.js';
import { flowrunsStatus } from './status.js';
import { flowrunsSummary } from './summary.js';
import { flowrunsInterrupt } from './interrupt.js';

export const registerFlowrunsCommands = (program: Command): void => {
  const flowruns = program.command('flowruns').description('Manage flow runs');

  withListOptions(flowruns.command('list').description('List flow runs (sorted by most recent first)'), { search: false })
    .requiredOption('--canvas-id <id>', 'Canvas ID')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq flowruns list --canvas-id <id>
  $ borgiq flowruns list --canvas-id <id> --all --json`,
    )
    .action(flowrunsList);

  flowruns
    .command('get <id>')
    .description('Get flow run details')
    .action(flowrunsGet);

  flowruns
    .command('status <id>')
    .description('Get flow run execution status')
    .action(flowrunsStatus);

  flowruns
    .command('summary <id>')
    .description('Get flow run summary')
    .action(flowrunsSummary);

  flowruns
    .command('interrupt <id>')
    .description('Interrupt a running flow')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(flowrunsInterrupt);
};
