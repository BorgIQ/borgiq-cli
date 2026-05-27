import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { flowrunMessagesList } from './list.js';
import { flowrunMessagesData } from './data.js';

export const registerFlowrunMessagesCommands = (program: Command): void => {
  const messages = program.command('flowrun-messages').description('Inspect flow run messages between actors');

  // The list endpoint hardcodes sort by emittedAt desc and does not honor search/sort filters.
  withListOptions(messages.command('list').description('List emitted messages for a flow run (sorted by most recent first)'), { search: false })
    .requiredOption('--canvas-id <id>', 'Canvas ID')
    .option('--flowrun-id <id>', 'Filter by flowrun ID')
    .requiredOption('--actor-id <id>', 'Actor ID')
    .action(flowrunMessagesList);

  messages
    .command('data <messageId>')
    .description('Get full emitted data for a message')
    .action(flowrunMessagesData);
};
