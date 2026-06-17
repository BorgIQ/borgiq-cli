import { handleError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { normalizeActorsInput, wrapBatch } from '../../lib/scaffold.js';

import { emitDocument } from './emit.js';

interface Options {
  file?: string;
  output?: string;
}

/** `borgiq scaffold batch` — wrap actor(s) in the canvas-actors batch envelope. */
export const scaffoldBatch = async (options: Options): Promise<void> => {
  try {
    const actorsMap = normalizeActorsInput(await readInput(options.file));
    const actors = Object.values(actorsMap) as { id: string }[];
    const doc = wrapBatch(actors, Date.now());
    emitDocument(doc, options);
  } catch (error) {
    handleError(error);
  }
};
