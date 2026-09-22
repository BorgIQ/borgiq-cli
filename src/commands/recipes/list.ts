import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import type { BIQRecipeKind, BIQRecipeMetadata } from '../../client/types.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

interface RecipesListOptions extends ListOptionFlags {
  kind?: string[];
  appId?: string;
}

const KINDS: BIQRecipeKind[] = ['ACTOR', 'FLOW', 'SEGMENT'];

/** the table row: apps flattened to their names, settings summarised as counts */
const toRow = (recipe: BIQRecipeMetadata) => ({
  ...recipe,
  appNames: recipe.apps.map((app) => app.name).join(', '),
  setup: `${recipe.settingsCount.connections} conn / ${recipe.settingsCount.credentials} cred / ${recipe.settingsCount.inputs} inputs`,
});

export const recipesList = async (options: RecipesListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const kinds = options.kind?.map((k) => k.toUpperCase() as BIQRecipeKind);
    if (kinds?.some((k) => !KINDS.includes(k))) {
      throw new Error(`--kind must be one of: ${KINDS.join(', ')}`);
    }

    const result = await collectAllPages(options, (params) =>
      client.listRecipes(ctx.org, ctx.workspace, {
        ...params,
        kinds,
        appId: options.appId,
      }),
    );

    output({ ...result, data: result.data.map(toRow) }, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'kind', header: 'KIND' },
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
