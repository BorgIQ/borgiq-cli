import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { withCanvasOption } from '../../lib/canvasFlag.js';
import { flowrunMessagesList } from './list.js';
import { flowrunMessagesData } from './data.js';

export const registerFlowrunMessagesCommands = (program: Command): void => {
  const messages = program.command('flowrun-messages').description('Inspect flow run messages between actors');

  withCanvasOption(withListOptions(messages.command('list').description('List emitted messages for a flow run (sorted by most recent first)'), { search: false }))
    .option('--flowrun-id <id>', 'Filter by flowrun ID')
    .requiredOption('--actor-id <id>', 'Actor ID')
    .action(flowrunMessagesList);

  messages
    .command('data <messageId>')
    .description('Get full emitted data for a message')
    .action(flowrunMessagesData);
};
