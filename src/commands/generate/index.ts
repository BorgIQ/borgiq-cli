import type { Command } from 'commander';

import { generateId } from './id.js';
import { generateMsgvar } from './msgvar.js';

export const registerGenerateCommands = (program: Command): void => {
  const generate = program
    .command('generate')
    .description('Generate IDs and identifiers for BorgIQ workflow artifacts (offline, no API call)');

  generate
    .command('id <type>')
    .description('Generate a unique ID. Types: actor, edge, sourceport, template, app, category, webhooktriggerkey')
    .action(generateId);

  generate
    .command('msgvar <name...>')
    .description('Convert an actor name to a valid msgVar identifier')
    .action(generateMsgvar);
};
