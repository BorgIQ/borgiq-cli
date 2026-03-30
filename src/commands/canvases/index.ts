import type { Command } from 'commander';

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

export const registerCanvasesCommands = (program: Command): void => {
  const canvases = program.command('canvases').description('Manage canvases');

  canvases
    .command('list')
    .description('List canvases in a workspace')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .option('--search <query>', 'Search filter')
    .action(canvasesList);

  canvases
    .command('get <id>')
    .description('Get canvas details')
    .option('--include-data', 'Include full flow data (actors, edges, positions)')
    .action(canvasesGet);

  canvases
    .command('create')
    .description('Create an empty canvas')
    .requiredOption('--name <name>', 'Canvas name')
    .requiredOption('--slug <slug>', 'Canvas slug')
    .option('--description <desc>', 'Canvas description')
    .option('--message-ttl <days>', 'Message TTL in days (1-14)', '7')
    .option('--tags <tags>', 'Canvas tags')
    .option('--runtime-slug <slug>', 'Runtime slug')
    .action(canvasesCreate);

  canvases
    .command('create-with-data')
    .description('Create a canvas with full flow data (actors + edges)')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .action(canvasesCreateWithData);

  canvases
    .command('update <id>')
    .description('Update canvas metadata')
    .option('--name <name>', 'Canvas name')
    .option('--slug <slug>', 'Canvas slug')
    .option('--description <desc>', 'Canvas description')
    .option('--tags <tags>', 'Canvas tags')
    .option('--message-ttl <days>', 'Message TTL in days (1-14)')
    .option('--runtime-slug <slug>', 'Runtime slug')
    .action(canvasesUpdate);

  canvases
    .command('update-data <id>')
    .description('Import canvas data (merge, insert, or replace actors)')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .option('--mode <mode>', 'Import mode: merge (default), insert, or replace', 'merge')
    .action(canvasesUpdateData);

  canvases
    .command('delete <id>')
    .description('Delete a canvas')
    .action(canvasesDelete);

  canvases
    .command('export <id>')
    .description('Export canvas data as JSON')
    .action(canvasesExport);

  canvases
    .command('validate <id>')
    .description('Validate canvas configuration before execution')
    .action(canvasesValidate);

  canvases
    .command('layout <id>')
    .description('Auto-layout canvas actors using ELK algorithm')
    .option('--source-actor-id <actorId...>', 'Layout only downstream of these actors')
    .action(canvasesLayout);

  canvases
    .command('verify-import')
    .description('Verify canvas import data before creating')
    .option('--file <path>', 'Path to JSON file (or pipe via stdin)')
    .action(canvasesVerifyImport);
};
