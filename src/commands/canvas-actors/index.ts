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
    canvasActors.command('list <canvas>').description('List actors in a canvas by slug or ID with optional filters'),
    { sort: { fields: ['name', 'type', 'createdAt'], defaultBy: 'name', defaultOrder: 'asc' } },
  )
    .option('--actor-type <type>', 'Filter by actor type (e.g. DenoActor, HttpRequestActor)')
    .option('--is-active <bool>', 'Filter by active status (true/false)')
    .action(canvasActorsList);

  canvasActors
    .command('get <canvas> <actorId>')
    .description('Get a single actor by ID from a canvas by slug or ID')
    .action(canvasActorsGet);

  canvasActors
    .command('flow <canvas> <actorId>')
    .description('Get an actor and all its downstream actors from a canvas by slug or ID')
    .action(canvasActorsFlow);

  canvasActors
    .command('verify <canvas>')
    .description('Verify actor options against the actor type schema for a canvas by slug or ID')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .action(canvasActorsVerify);

  canvasActors
    .command('create <canvas> <actorId>')
    .description('Create a single actor in a canvas by slug or ID')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .action(canvasActorsCreate);

  canvasActors
    .command('update <canvas> <actorId>')
    .description('Update a single actor in a canvas by slug or ID')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .action(canvasActorsUpdate);

  canvasActors
    .command('delete <canvas> <actorId>')
    .description('Delete a single actor from a canvas by slug or ID')
    .option('--edit-version <version>', 'Edit version for conflict detection')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(canvasActorsDelete);

  canvasActors
    .command('batch <canvas>')
    .description('Apply batch actor operations to a canvas by slug or ID')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .addHelpText(
      'after',
      `
Example:
  $ cat ops.json | borgiq canvas-actors batch <canvas> --file -`,
    )
    .action(canvasActorsBatch);
};
