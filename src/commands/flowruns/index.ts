import type { Command } from 'commander';

import { flowrunsList } from './list.js';
import { flowrunsGet } from './get.js';
import { flowrunsStatus } from './status.js';
import { flowrunsSummary } from './summary.js';
import { flowrunsInterrupt } from './interrupt.js';

export const registerFlowrunsCommands = (program: Command): void => {
  const flowruns = program.command('flowruns').description('Manage flow runs');

  flowruns
    .command('list')
    .description('List flow runs')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .requiredOption('--canvas-id <id>', 'Canvas ID')
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
    .action(flowrunsInterrupt);
};
