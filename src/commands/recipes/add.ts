import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import type { RecipeInstantiateBody, RecipeSettingsValues } from '../../client/types.js';

interface RecipesAddOptions {
  canvas: string;
  x?: number;
  y?: number;
  after?: string;
  intoEdge?: string;
  settings?: string;
}

/** `ACTR…` or `ACTR…:SPRTxyz` → the source to wire from; with no port named the API picks the actor's first source port */
export const parseAfter = (value: string): { actorId: string; portId?: string } => {
  const [actorId, portId, ...rest] = value.split(':');
  if (!actorId || portId === '' || rest.length > 0) throw new CliUsageError('--after expects <actorId> or <actorId>:<portId>');
  return portId === undefined ? { actorId } : { actorId, portId };
};

/** the request body from the flags — format only; what the flags mean is the API's to decide */
export const buildInstantiateBody = async (options: RecipesAddOptions): Promise<RecipeInstantiateBody> => {
  if (options.after && options.intoEdge) throw new CliUsageError('pass either --after or --into-edge, not both');
  if ((options.x === undefined) !== (options.y === undefined)) throw new CliUsageError('--x and --y go together');
  if ((options.x !== undefined && Number.isNaN(options.x)) || (options.y !== undefined && Number.isNaN(options.y))) throw new CliUsageError('--x and --y must be numbers');
  const body: RecipeInstantiateBody = {};
  if (options.x !== undefined && options.y !== undefined) body.position = { x: options.x, y: options.y };
  if (options.after) body.source = parseAfter(options.after);
  if (options.intoEdge) body.edgeId = options.intoEdge;
  if (options.settings) {
    const settings = await readInput(options.settings === '-' ? undefined : options.settings);
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new CliUsageError('--settings must be a JSON or YAML object with connections, credentials and/or inputs');
    body.settings = settings as RecipeSettingsValues;
  }
  return body;
};

/** `borgiq recipes add <id> --canvas <c> [...]` — the API instantiates the recipe and returns the new actor ids. */
export const recipesAdd = async (id: string, options: RecipesAddOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await buildInstantiateBody(options);
    const result = await client.instantiateRecipe(ctx.org, ctx.workspace, options.canvas, id, body);
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
