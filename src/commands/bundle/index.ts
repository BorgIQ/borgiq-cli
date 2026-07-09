import type { Command } from 'commander';

import { bundleInit } from './init.js';
import { bundlePack } from './pack.js';
import { bundlePull } from './pull.js';
import { bundlePush } from './push.js';
import { bundleUnpack } from './unpack.js';
import { bundleValidate } from './validate.js';

export const registerBundleCommands = (program: Command): void => {
  const bundle = program
    .command('bundle')
    .description('Convert canvases to/from git-friendly bundle folders');

  bundle
    .command('init <dir>')
    .description('Create a starter canvas bundle folder (offline, git-ready)')
    .option('--name <name>', 'Canvas name (default: derived from the directory name)')
    .option('--slug <slug>', 'Canvas slug (default: derived from the directory name)')
    .action(bundleInit);

  bundle
    .command('unpack <file> <dir>')
    .description("Expand a canvas export document into a bundle folder ('-' reads stdin)")
    .option('--force', 'Replace managed files in an existing bundle or write into another non-empty directory')
    .addHelpText('after', `
Examples:
  $ borgiq canvases export my-canvas --json | borgiq bundle unpack - ./my-canvas.borgiq-canvas
  $ borgiq bundle unpack export.yaml ./my-canvas.borgiq-canvas`)
    .action(bundleUnpack);

  bundle
    .command('pack <dir>')
    .description('Compile a bundle folder back into a canvas export document')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .option('--strict', 'Treat warnings as errors')
    .action(bundlePack);

  bundle
    .command('validate <dir>')
    .description('Validate a bundle folder and report file-scoped errors and warnings')
    .option('--strict', 'Treat warnings as errors')
    .action(bundleValidate);

  bundle
    .command('pull <canvas> [dir]')
    .description('Sync a canvas by slug or ID from the API into a bundle folder')
    .option('--replace', 'Use the legacy full managed-path rewrite instead of incremental sync')
    .option('--force', 'Write into a non-empty directory that is not a bundle')
    .option('--dry-run', 'Show the pull sync plan without writing files')
    .action(bundlePull);

  bundle
    .command('push <dir>')
    .description('Validate and sync a bundle into a canvas by slug or ID')
    .option('--canvas <canvas>', "Target canvas slug or ID (default: the bundle's canvas.slug)")
    .option('--mode <mode>', 'Legacy whole-document import mode: merge, insert, or replace')
    .option('--create', 'Create a new canvas from the bundle metadata instead of importing')
    .option('--force-local', 'Resolve sync conflicts by applying the local actor version')
    .option('--dry-run', 'Show the push sync plan without applying changes')
    .option('--no-refresh', 'Skip the post-push pull that refreshes local version markers')
    .option('--strict', 'Treat validation warnings as errors')
    .option('--raw', 'Include generated operation payloads and raw API responses in output')
    .option('--auto-layout', 'Run canvas auto-layout after a successful sync, create, or legacy import')
    .option('--layout-source-actor-id <actorId...>', 'Auto-layout only downstream of these actors (implies --auto-layout)')
    .addHelpText('after', `
Examples:
  $ borgiq bundle pull my-canvas-slug
  $ borgiq bundle pull CANV01abc...
  $ borgiq bundle push ./my-canvas.borgiq-canvas
  $ borgiq bundle push ./my-canvas.borgiq-canvas --dry-run
  $ borgiq bundle push ./my-canvas.borgiq-canvas --force-local
  $ borgiq bundle push ./my-canvas.borgiq-canvas --raw
  $ borgiq bundle push ./my-canvas.borgiq-canvas --canvas my-canvas-slug --mode replace
  $ borgiq bundle push ./my-canvas.borgiq-canvas --create --auto-layout`)
    .action(bundlePush);
};
