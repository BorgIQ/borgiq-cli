import type { Command } from 'commander';

import { actorsList } from './list.js';
import { actorsSchema } from './schema.js';

export const registerActorsCommands = (program: Command): void => {
  const actors = program.command('actors').description('Browse available actor types');

  actors
    .command('list')
    .description('List all available actor types')
    .action(actorsList);

  actors
    .command('schema <actorType>')
    .description('Get configuration schema for an actor type')
    .action(actorsSchema);
};
