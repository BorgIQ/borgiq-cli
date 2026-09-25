import type { Command } from 'commander';

import { withListOptions } from '../../lib/listOptions.js';
import { recipesList } from './list.js';
import { recipesGet } from './get.js';
import { recipesApps } from './apps.js';
import { recipesAdd } from './add.js';

/**
 * Recipes: saved, unversioned starting points (a task actor, a trigger, a flow or a flow segment) added to a
 * canvas. Browsing and adding are BorgIQ API calls — the CLI never instantiates a recipe itself, and what fits
 * where (which kinds, which wiring, which settings) is the API's to decide.
 */
export const registerRecipesCommands = (program: Command): void => {
  const recipes = program.command('recipes').description('Browse BorgIQ recipes and add one to a canvas');

  withListOptions(recipes.command('list').description('List or search recipes in a workspace'), {
    sort: { fields: ['name', 'createdAt', 'updatedAt'], defaultBy: 'name', defaultOrder: 'asc' },
  })
    .option('--kind <kind...>', 'Filter by kind, e.g. TASK, TRIGGER, FLOW or SEGMENT (repeatable)')
    .option('--app-id <id>', 'Filter by template app id')
    .option('--has-entry', 'Only recipes with an entry (something can feed them)')
    .option('--no-has-entry', 'Only recipes without an entry')
    .option('--has-exit', 'Only recipes with an exit (they can feed something onward)')
    .option('--no-has-exit', 'Only recipes without an exit')
    .action(recipesList);

  recipes
    .command('get <id>')
    .description('Get a recipe: its actors, entry/exit, and the settings it asks for (each group\'s groupKey is its key in --settings)')
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
    .option('--x <n>', 'X where the recipe lands, in flow coordinates (with --y; default: below everything on the canvas)', Number)
    .option('--y <n>', 'Y where the recipe lands, in flow coordinates (with --x)', Number)
    .option('--after <actorId[:portId]>', 'Wire this actor\'s source port to the recipe\'s entry (its first source port unless one is named)')
    .option('--into-edge <edgeId>', 'Splice the recipe into this edge (its source feeds the entry, the exit feeds the old target)')
    .option('--settings <path>', 'JSON or YAML file of settings values (connections and credentials by groupKey, inputs by key), or - for stdin')
    .action(recipesAdd);
};
