import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { assetsList } from './list.js';
import { assetsDelete } from './delete.js';
import { assetsCreate } from './create.js';
import { assetsEdit } from './edit.js';

export const registerAssetsCommands = (program: Command): void => {
  const assets = program.command('assets').description('Manage assets');

  withListOptions(assets.command('list').description('List assets'), {
    sortFields: ['key', 'createdAt', 'updatedAt'],
    defaultSortBy: 'key',
    defaultSortOrder: 'asc',
  })
    .action(assetsList);

  assets
    .command('create')
    .description('Create an asset (text or file). Prompts interactively when flags are missing.')
    .option('--key <key>', 'Asset key (unique within workspace)')
    .option('--type <type>', 'Asset type: plainText | json | yaml | file')
    .option('--description <desc>', 'Asset description')
    .option('--data <data>', 'Inline data for text assets')
    .option('--data-file <path>', 'Path to file containing data for text assets')
    .option('--file <path>', 'Path to file for file-type assets (use - for stdin)')
    .option('--file-name <name>', 'File name (required when piping file data via stdin)')
    .action(assetsCreate);

  assets
    .command('edit <id>')
    .description('Edit an existing asset')
    .option('--key <key>', 'New asset key')
    .option('--description <desc>', 'New description')
    .option('--data <data>', 'New inline data for text assets')
    .option('--data-file <path>', 'Path to file containing new data for text assets')
    .option('--update-file', 'Replace the underlying file (file-type assets)')
    .option('--file <path>', 'Path to new file when --update-file is set (use - for stdin)')
    .option('--file-name <name>', 'File name (required when piping file data via stdin)')
    .action(assetsEdit);

  assets
    .command('delete <id>')
    .description('Delete an asset')
    .action(assetsDelete);
};
