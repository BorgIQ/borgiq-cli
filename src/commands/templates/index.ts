import type { Command } from 'commander';

import { templatesList } from './list.js';
import { templatesGet } from './get.js';
import { templatesApps } from './apps.js';

export const registerTemplatesCommands = (program: Command): void => {
  const templates = program.command('templates').description('Browse and search BorgIQ actor templates');

  templates
    .command('list')
    .description('List or search templates in a workspace')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .option('--search <query>', 'Search by name, description, or tags')
    .option('--type <type...>', 'Filter by template type: TASK or TRIGGER (repeatable)')
    .option('--app-id <id>', 'Filter by template app id')
    .action(templatesList);

  templates
    .command('get <id>')
    .description('Get a single template (includes actor definition)')
    .action(templatesGet);

  templates
    .command('apps')
    .description('List template apps available for filtering')
    .option('--page <page>', 'Page number')
    .option('--page-size <size>', 'Results per page')
    .option('--search <query>', 'Search filter')
    .option('--category-id <id>', 'Filter by template category id')
    .action(templatesApps);
};
