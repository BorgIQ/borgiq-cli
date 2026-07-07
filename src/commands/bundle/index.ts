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
    .description('Convert canvases to/from git-friendly bundle folders (BORG-565)');

  bundle
    .command('init <dir>')
    .description('Create a starter canvas bundle folder (offline, git-ready)')
    .option('--name <name>', 'Canvas name (default: derived from the directory name)')
    .option('--slug <slug>', 'Canvas slug (default: derived from the directory name)')
    .action(bundleInit);

  bundle
    .command('unpack <file> <dir>')
    .description("Expand a canvas export document into a bundle folder ('-' reads stdin)")
    .option('--force', 'Write into a non-empty directory that is not a bundle')
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
    .description('Export a canvas from the API and unpack it into a bundle folder')
    .option('--force', 'Write into a non-empty directory that is not a bundle')
    .action(bundlePull);

  bundle
    .command('push <dir>')
    .description('Validate, pack, and import a bundle into a canvas')
    .option('--canvas <slugOrId>', "Target canvas (default: the bundle's canvas.slug)")
    .option('--mode <mode>', 'Import mode: merge (default), insert, or replace')
    .option('--create', 'Create a new canvas from the bundle metadata instead of importing')
    .option('--strict', 'Treat validation warnings as errors')
    .addHelpText('after', `
Examples:
  $ borgiq bundle pull my-canvas
  $ borgiq bundle push ./my-canvas.borgiq-canvas
  $ borgiq bundle push ./my-canvas.borgiq-canvas --mode replace
  $ borgiq bundle push ./my-canvas.borgiq-canvas --create`)
    .action(bundlePush);
};
