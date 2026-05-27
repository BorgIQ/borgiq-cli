import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { templatesList } from './list.js';
import { templatesGet } from './get.js';
import { templatesApps } from './apps.js';

export const registerTemplatesCommands = (program: Command): void => {
  const templates = program.command('templates').description('Browse and search BorgIQ actor templates');

  withListOptions(templates.command('list').description('List or search templates in a workspace'), {
    sort: { fields: ['name', 'createdAt', 'updatedAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .option('--type <type...>', 'Filter by template type: TASK or TRIGGER (repeatable)')
    .option('--app-id <id>', 'Filter by template app id')
    .action(templatesList);

  templates
    .command('get <id>')
    .description('Get a single template (includes actor definition)')
    .action(templatesGet);

  withListOptions(templates.command('apps').description('List template apps available for filtering'), {
    sort: { fields: ['name', 'createdAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .option('--category-id <id>', 'Filter by template category id')
    .action(templatesApps);
};
