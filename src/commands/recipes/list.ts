import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import type { BIQRecipeMetadata } from '../../client/types.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

interface RecipesListOptions extends ListOptionFlags {
  kind?: string[];
  appId?: string;
  /** true (--has-entry), false (--no-has-entry), or unset */
  hasEntry?: boolean;
  /** true (--has-exit), false (--no-has-exit), or unset */
  hasExit?: boolean;
}

/** where the recipe can be wired: `in→out` (entry and exit), `in`, `out`, or `—` for neither */
export const wiringOf = (recipe: Pick<BIQRecipeMetadata, 'entry' | 'exit'>): string => {
  if (recipe.entry && recipe.exit) return 'in→out';
  if (recipe.entry) return 'in';
  if (recipe.exit) return 'out';
  return '—';
};

/** the table row: apps flattened to their names, wiring and settings summarised; entry and exit stay as the API sent them */
const toRow = (recipe: BIQRecipeMetadata) => ({
  ...recipe,
  appNames: recipe.apps.map((app) => app.name).join(', '),
  wiring: wiringOf(recipe),
  setup: `${recipe.settingsCount.connections} conn / ${recipe.settingsCount.credentials} cred / ${recipe.settingsCount.inputs} inputs`,
});

export const recipesList = async (options: RecipesListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // upper-cased for convenience and otherwise passed through: which kinds exist is the API's to say
    const kinds = options.kind?.map((k) => k.toUpperCase());

    const result = await collectAllPages(options, (params) =>
      client.listRecipes(ctx.org, ctx.workspace, {
        ...params,
        kinds,
        appId: options.appId,
        hasEntry: options.hasEntry,
        hasExit: options.hasExit,
      }),
    );

    output({ ...result, data: result.data.map(toRow) }, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'kind', header: 'KIND' },
        { key: 'wiring', header: 'WIRING' },
        { key: 'actorCount', header: 'ACTORS' },
        { key: 'appNames', header: 'APPS' },
        { key: 'setup', header: 'SETUP' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Recipes',
    });
  } catch (error) {
    handleError(error);
  }
};
