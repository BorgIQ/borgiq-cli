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
    canvasActors.command('list <canvasId>').description('List actors in a canvas with optional filters'),
    { sortFields: ['name', 'type', 'createdAt'], defaultSortBy: 'name', defaultSortOrder: 'asc' },
  )
    .option('--actor-type <type>', 'Filter by actor type (e.g. DenoActor, HttpRequestActor)')
    .option('--is-active <bool>', 'Filter by active status (true/false)')
    .action(canvasActorsList);

  canvasActors
    .command('get <canvasId> <actorId>')
    .description('Get a single actor by ID')
    .action(canvasActorsGet);

  canvasActors
    .command('flow <canvasId> <actorId>')
    .description('Get an actor and all its downstream actors')
    .action(canvasActorsFlow);

  canvasActors
    .command('verify <canvasId>')
    .description('Verify actor options against the actor type schema')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .action(canvasActorsVerify);

  canvasActors
    .command('create <canvasId> <actorId>')
    .description('Create a single actor in a canvas')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .action(canvasActorsCreate);

  canvasActors
    .command('update <canvasId> <actorId>')
    .description('Update a single actor (partial update)')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .action(canvasActorsUpdate);

  canvasActors
    .command('delete <canvasId> <actorId>')
    .description('Delete a single actor from a canvas')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .action(canvasActorsDelete);

  canvasActors
    .command('batch <canvasId>')
    .description('Apply batch actor operations (add, update, remove multiple actors)')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .action(canvasActorsBatch);
};
