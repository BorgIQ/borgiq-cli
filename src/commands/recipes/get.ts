import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import type { BIQRecipeDetail } from '../../client/types.js';

const actors = (ids: string[]): string => `${ids.length} actor${ids.length === 1 ? '' : 's'}`;

/**
 * A reader's summary of a recipe: where it wires in, and the key each setting goes under in `--settings` — the
 * groupKeys the API returns, printed as they come (the JSON buries them under the actors).
 */
export const describeRecipe = (recipe: BIQRecipeDetail): string[] => {
  const entry = recipe.entry ? `entry ${recipe.entry.actorId}` : 'no entry';
  const exit = recipe.exit ? `exit ${recipe.exit.actorId}:${recipe.exit.portId}` : 'no exit';
  const lines = [`${recipe.name} (${recipe.kind}): ${entry}, ${exit}`];

  const { connections, credentials, inputs } = recipe.settings;
  if (connections.length + credentials.length + inputs.length === 0) {
    lines.push('Settings: none');
    return lines;
  }
  lines.push('Settings (the keys --settings takes):');
  if (connections.length > 0) {
    lines.push('  connections:');
    for (const group of connections) lines.push(`    ${group.groupKey}  ${group.label ? `${group.label}, ` : ''}${actors(group.actorIds)}`);
  }
  if (credentials.length > 0) {
    lines.push('  credentials:');
    for (const group of credentials) lines.push(`    ${group.groupKey}  ${group.label ? `${group.label}, ` : ''}${group.source}, ${actors(group.actorIds)}`);
  }
  if (inputs.length > 0) {
    lines.push('  inputs:');
    for (const input of inputs) {
      const facts = [input.type, input.required ? 'required' : undefined, input.default !== undefined ? `default ${JSON.stringify(input.default)}` : undefined];
      lines.push(`    ${input.key}  ${input.label} (${facts.filter(Boolean).join(', ')})`);
    }
  }
  return lines;
};

export const recipesGet = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const recipe = await client.getRecipe(ctx.org, ctx.workspace, id);
    output(recipe, globalOpts);
    // after the JSON, so it is what a person at a terminal sees last; stderr, so a pipe gets only the JSON
    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`\n${describeRecipe(recipe).join('\n')}\n`);
    }
  } catch (error) {
    handleError(error);
  }
};
