import type { Command } from 'commander';

import { flowrunMessagesList } from './list.js';
import { flowrunMessagesData } from './data.js';

export const registerFlowrunMessagesCommands = (program: Command): void => {
  const messages = program.command('flowrun-messages').description('Inspect flow run messages between actors');

  messages
    .command('list')
    .description('List emitted messages for a flow run')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .requiredOption('--canvas-id <id>', 'Canvas ID')
    .option('--flowrun-id <id>', 'Filter by flowrun ID')
    .requiredOption('--actor-id <id>', 'Actor ID')
    .action(flowrunMessagesList);

  messages
    .command('data <messageId>')
    .description('Get full emitted data for a message')
    .action(flowrunMessagesData);
};
