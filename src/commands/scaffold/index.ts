import type { Command } from 'commander';

import { scaffoldActor } from './actor.js';
import { scaffoldActorFromTemplate } from './actorFromTemplate.js';
import { scaffoldCanvas } from './canvas.js';
import { scaffoldBatch } from './batch.js';

export const registerScaffoldCommands = (program: Command): void => {
  const scaffold = program
    .command('scaffold')
    .description('Scaffold canvas-ready actors, canvases, and batch operations');

  scaffold
    .command('actor')
    .description('Scaffold a CanvasActor from an actor type schema (defaults come from the platform)')
    .requiredOption('--type <type>', 'Actor type (e.g. HttpRequestActor, DenoActor)')
    .requiredOption('--name <name>', 'Actor name')
    .option('--routes <routes>', 'Comma-separated route names (RouterActor / AiRouterActor)')
    .option('--output <path>', 'Write JSON to a file instead of stdout')
    .option('--print-id', 'Print only the new actor id to stdout (JSON goes to --output)')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq scaffold actor --type HttpRequestActor --name "Fetch users" --output actor.json
  $ borgiq scaffold actor --type RouterActor --name "Route by status" --routes "Active,Inactive"`,
    )
    .action(scaffoldActor);

  scaffold
    .command('actor-from-template')
    .description('Convert a `templates get` payload into a CanvasActor (keeps template provenance)')
    .option('--file <path>', 'Template JSON file (or pipe `borgiq templates get --json` to stdin)')
    .option('--name <name>', 'Override the actor name (defaults to the template name)')
    .option('--output <path>', 'Write JSON to a file instead of stdout')
    .option('--print-id', 'Print only the new actor id to stdout (JSON goes to --output)')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq templates get ATMP... --json | borgiq scaffold actor-from-template --output actor.json
  $ ID=$(borgiq templates get ATMP... --json | borgiq scaffold actor-from-template --output actor.json --print-id)
  $ borgiq canvas-actors create CANV... "$ID" --file actor.json --json`,
    )
    .action(scaffoldActorFromTemplate);

  scaffold
    .command('canvas')
    .description('Wrap actor(s) in the ExportedCanvasData envelope for `canvases create-with-data`')
    .requiredOption('--name <name>', 'Canvas name')
    .requiredOption('--slug <slug>', 'Canvas slug')
    .option('--message-ttl <days>', 'messageTTLInDays (default 7)')
    .option('--file <path>', 'Actor(s) JSON: a single actor, an array, or an id→actor map (or stdin)')
    .option('--output <path>', 'Write JSON to a file instead of stdout')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq scaffold canvas --name "My flow" --slug my-flow --file actors.json --output canvas.json
  $ borgiq canvases create-with-data --file canvas.json --json`,
    )
    .action(scaffoldCanvas);

  scaffold
    .command('batch')
    .description('Wrap actor(s) in the operations envelope for `canvas-actors batch`')
    .option('--file <path>', 'Actor(s) JSON: a single actor, an array, or an id→actor map (or stdin)')
    .option('--output <path>', 'Write JSON to a file instead of stdout')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq scaffold batch --file actors.json --output ops.json
  $ borgiq canvas-actors batch CANV... --file ops.json --json`,
    )
    .action(scaffoldBatch);
};
