import { handleError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { actorFromTemplate } from '../../lib/scaffold.js';
import type { BIQActorTemplateDetail } from '../../client/types.js';

import { emitActor } from './emit.js';

interface Options {
  file?: string;
  name?: string;
  output?: string;
  printId?: boolean;
}

/** `borgiq scaffold actor-from-template` — convert a `templates get` payload. */
export const scaffoldActorFromTemplate = async (options: Options): Promise<void> => {
  try {
    const template = (await readInput(options.file)) as BIQActorTemplateDetail;
    const actor = actorFromTemplate(template, { name: options.name });
    emitActor(actor, options);
  } catch (error) {
    handleError(error);
  }
};
