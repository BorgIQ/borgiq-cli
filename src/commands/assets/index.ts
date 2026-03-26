import type { Command } from 'commander';

import { assetsList } from './list.js';
import { assetsDelete } from './delete.js';

export const registerAssetsCommands = (program: Command): void => {
  const assets = program.command('assets').description('Manage assets');

  assets
    .command('list')
    .description('List assets')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .action(assetsList);

  assets
    .command('delete <id>')
    .description('Delete an asset')
    .action(assetsDelete);
};
