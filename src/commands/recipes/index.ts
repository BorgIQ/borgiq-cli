import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { recipesList } from './list.js';
import { recipesGet } from './get.js';
import { recipesApps } from './apps.js';
import { recipesAdd } from './add.js';

/**
 * Recipes: saved, unversioned starting points (an actor, a flow, a segment) added to a canvas. Browsing
 * and adding are BorgIQ API calls — the CLI never instantiates a recipe itself.
 */
export const registerRecipesCommands = (program: Command): void => {
  const recipes = program.command('recipes').description('Browse BorgIQ recipes and add one to a canvas');

  withListOptions(recipes.command('list').description('List or search recipes in a workspace'), {
    sort: { fields: ['name', 'createdAt', 'updatedAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .option('--kind <kind...>', 'Filter by kind: ACTOR, FLOW or SEGMENT (repeatable)')
    .option('--app-id <id>', 'Filter by template app id')
    .action(recipesList);

  recipes
    .command('get <id>')
    .description('Get a recipe: its actors, entry/exit, and the settings it asks for')
    .action(recipesGet);

  withListOptions(recipes.command('apps').description('List the template apps that hold recipes'), {
    sort: { fields: ['name', 'createdAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .option('--category-id <id>', 'Filter by template category id')
    .action(recipesApps);

  recipes
    .command('add <id>')
    .description('Add a recipe to a canvas (the API instantiates it: fresh ids, settings applied, wired in)')
    .requiredOption('--canvas <canvas>', 'Canvas slug or id')
    .option('--x <n>', 'X of the entry actor, in flow coordinates', Number)
    .option('--y <n>', 'Y of the entry actor, in flow coordinates', Number)
    .option('--after <actorId[:portId]>', 'Wire this actor\'s source port (default SPRTdefault) to the recipe\'s entry')
    .option('--into-edge <edgeId>', 'Splice the recipe into this edge (its source feeds the entry, the exit feeds the old target)')
    .option('--settings <path>', 'JSON or YAML file of settings values (connections, credentials, inputs), or - for stdin')
    .action(recipesAdd);
};
