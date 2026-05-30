import type { Command } from 'commander';

import { scaffoldCanvas } from './canvas.js';
import { scaffoldActorFromTemplate } from './actor-from-template.js';

export const registerScaffoldCommands = (program: Command): void => {
  const scaffold = program
    .command('scaffold')
    .description('Scaffold canvas/actor JSON for deployment (offline, no API call)');

  scaffold
    .command('canvas')
    .description('Generate canvas JSON (ExportedCanvasData) from a built-in template')
    .requiredOption('--name <name>', 'Canvas name')
    .requiredOption('--slug <slug>', 'Canvas slug')
    .option('--description <text>', 'Canvas description')
    .option('--template <template>', 'Template: button-http, webhook-router, button-deno, scheduled-http, button-ai', 'button-http')
    .option('--ttl <days>', 'Message TTL in days', '7')
    .option('--output <path>', 'Write JSON to this file (default: stdout)')
    .action(scaffoldCanvas);

  scaffold
    .command('actor-from-template')
    .description('Convert a `borgiq templates get` JSON payload into a CanvasActor body')
    .option('--file <path>', 'Template JSON path (default: stdin)')
    .option('--output <path>', 'Write result here (default: stdout)')
    .option('--actor-id <id>', 'Use this id instead of generating one')
    .option('--name <name>', 'Override actor name')
    .option('--msg-var <var>', 'Override msgVar (default: derived from name)')
    .option('--description <text>', 'Override description')
    .option('--position-x <n>', 'Override position.x')
    .option('--position-y <n>', 'Override position.y')
    .option('--batch', 'Wrap as a single-op `canvas-actors batch` body')
    .option('--include-id', 'Include `id` in the actor body')
    .option('--print-id', 'Echo new actor id to stderr')
    .option('--no-print-id', 'Suppress the stderr id echo')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq templates get TMPL01... --json | borgiq scaffold actor-from-template
  $ borgiq templates get TMPL01... --json | borgiq scaffold actor-from-template --batch \\
      | borgiq canvas-actors batch CANV01... --file - --json`,
    )
    .action(scaffoldActorFromTemplate);
};
