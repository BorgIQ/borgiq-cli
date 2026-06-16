import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { canvasActorsList } from './list.js';
import { canvasActorsGet } from './get.js';
import { canvasActorsFlow } from './flow.js';
import { canvasActorsVerify } from './verify.js';
import { canvasActorsCreate } from './create.js';
import { canvasActorsUpdate } from './update.js';
import { canvasActorsDelete } from './delete.js';
import { canvasActorsBatch } from './batch.js';

export const registerCanvasActorsCommands = (program: Command): void => {
  const canvasActors = program.command('canvas-actors').description('Manage individual actors within a canvas');

  withListOptions(
    canvasActors.command('list <canvasSlugOrId>').description('List actors in a canvas with optional filters'),
    { sort: { fields: ['name', 'type', 'createdAt'], defaultBy: 'name', defaultOrder: 'asc' } },
  )
    .option('--actor-type <type>', 'Filter by actor type (e.g. DenoActor, HttpRequestActor)')
    .option('--is-active <bool>', 'Filter by active status (true/false)')
    .action(canvasActorsList);

  canvasActors
    .command('get <canvasSlugOrId> <actorId>')
    .description('Get a single actor by ID')
    .action(canvasActorsGet);

  canvasActors
    .command('flow <canvasSlugOrId> <actorId>')
    .description('Get an actor and all its downstream actors')
    .action(canvasActorsFlow);

  canvasActors
    .command('verify <canvasSlugOrId>')
    .description('Verify actor options against the actor type schema')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .action(canvasActorsVerify);

  canvasActors
    .command('create <canvasSlugOrId> <actorId>')
    .description('Create a single actor in a canvas')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .action(canvasActorsCreate);

  canvasActors
    .command('update <canvasSlugOrId> <actorId>')
    .description('Update a single actor (partial update)')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .action(canvasActorsUpdate);

  canvasActors
    .command('delete <canvasSlugOrId> <actorId>')
    .description('Delete a single actor from a canvas')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(canvasActorsDelete);

  canvasActors
    .command('batch <canvasSlugOrId>')
    .description('Apply batch actor operations (add, update, remove multiple actors)')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .addHelpText(
      'after',
      `
Example:
  $ cat ops.json | borgiq canvas-actors batch <canvasSlugOrId> --file -`,
    )
    .action(canvasActorsBatch);
};
