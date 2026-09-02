import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { canvasesList } from './list.js';
import { canvasesGet } from './get.js';
import { canvasesCreate } from './create.js';
import { canvasesCreateWithData } from './create-with-data.js';
import { canvasesUpdate } from './update.js';
import { canvasesUpdateData } from './update-data.js';

import { canvasesDelete } from './delete.js';
import { canvasesExport } from './export.js';
import { canvasesValidate } from './validate.js';
import { canvasesLayout } from './layout.js';
import { canvasesVerifyImport } from './verify-import.js';
import { canvasesRuntimeBuild, canvasesRuntimeBuildStatus, canvasesRuntimeBuildActivate } from './runtime-build.js';

export const registerCanvasesCommands = (program: Command): void => {
  const canvases = program.command('canvases').description('Manage canvases');

  withListOptions(canvases.command('list').description('List canvases in a workspace'), {
    sort: { fields: ['name', 'createdAt', 'updatedAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .action(canvasesList);

  canvases
    .command('get <canvas>')
    .description('Get canvas details by slug or ID')
    .option('--include-data', 'Include full flow data (actors, edges, positions)')
    .action(canvasesGet);

  canvases
    .command('create')
    .description('Create an empty canvas. Prompts interactively when required flags are missing.')
    .option('--name <name>', 'Canvas name')
    .option('--slug <slug>', 'Canvas slug')
    .option('--description <desc>', 'Canvas description')
    .option('--message-ttl <days>', 'Message TTL in days (1-14)', '7')
    .option('--tags <tags>', 'Canvas tags')
    .option('--runtime-slug <slug>', 'Runtime slug')
    .action(canvasesCreate);

  canvases
    .command('create-with-data')
    .description('Create a canvas with full flow data (actors + edges)')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .option('--auto-layout', 'Run canvas auto-layout after creating the canvas')
    .option('--layout-source-actor-id <actorId...>', 'Auto-layout only downstream of these actors (implies --auto-layout)')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq canvases create-with-data --file flow.json
  $ borgiq canvases create-with-data --file flow.json --auto-layout
  $ borgiq canvases export <canvas> | borgiq canvases create-with-data --file -`,
    )
    .action(canvasesCreateWithData);

  canvases
    .command('update <canvas>')
    .description('Update canvas metadata by slug or ID')
    .option('--name <name>', 'Canvas name')
    .option('--slug <slug>', 'Canvas slug')
    .option('--description <desc>', 'Canvas description')
    .option('--tags <tags>', 'Canvas tags')
    .option('--message-ttl <days>', 'Message TTL in days (1-14)')
    .option('--runtime-slug <slug>', 'Runtime slug')
    .action(canvasesUpdate);

  canvases
    .command('update-data <canvas>')
    .description('Import canvas data by slug or ID (merge, insert, or replace actors)')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .option('--mode <mode>', 'Import mode: merge (default), insert, or replace', 'merge')
    .option('--auto-layout', 'Run canvas auto-layout after a successful import')
    .option('--layout-source-actor-id <actorId...>', 'Auto-layout only downstream of these actors (implies --auto-layout)')
    .action(canvasesUpdateData);

  canvases
    .command('delete <canvas>')
    .description('Delete a canvas by slug or ID')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--force', 'Alias for --yes')
    .action(canvasesDelete);

  canvases
    .command('export <canvas>')
    .description('Export canvas data by slug or ID as JSON')
    .action(canvasesExport);

  canvases
    .command('validate <canvas>')
    .description('Validate canvas configuration by slug or ID before execution')
    .action(canvasesValidate);

  canvases
    .command('layout <canvas>')
    .description('Auto-layout canvas actors by slug or ID using ELK algorithm')
    .option('--source-actor-id <actorId...>', 'Layout only downstream of these actors')
    .action(canvasesLayout);

  canvases
    .command('verify-import')
    .description('Verify canvas import data before creating')
    .option('--file <path>', 'Path to JSON or YAML file (or pipe via stdin)')
    .action(canvasesVerifyImport);

  canvases
    .command('runtime-build <canvas>')
    .description('Build this canvas: compile its code actors and install their dependencies ahead of time')
    .option('--timeout <seconds>', 'How long to wait for the build before giving up on the answer', '900')
    .addHelpText(
      'after',
      `
Building takes a snapshot of the canvas, compiles every code actor on it, and installs their
dependencies. On a deployed workspace, triggers then run that build instead of the canvas's current
code — so actors start fast and every run executes the same thing.

The command holds until the build finishes (typically a minute or two) and prints the per-actor
outcome. --timeout bounds only the wait; the server finishes the build either way, and
'runtime-build-status' shows the outcome.

Exit codes:
  0  the build completed. A partly-built canvas also exits 0: the actors that built run from the
     build, and the ones that did not are listed with the reason.
  1  the build failed outright, or the wait timed out (the build itself keeps going).

Examples:
  $ borgiq canvases runtime-build my-canvas
  $ borgiq canvases runtime-build my-canvas --json
`,
    )
    .action(canvasesRuntimeBuild);

  canvases
    .command('runtime-build-status <canvas>')
    .description('Show which build this canvas runs, and whether it has been edited since')
    .option('--history', 'List this canvas\'s builds instead')
    .action(canvasesRuntimeBuildStatus);

  canvases
    .command('runtime-build-activate <canvas> <buildId>')
    .description('Make an earlier build the one this canvas\'s triggers run')
    .action(canvasesRuntimeBuildActivate);
};
