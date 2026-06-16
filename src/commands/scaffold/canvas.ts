import { handleError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { normalizeActorsInput, wrapCanvasEnvelope } from '../../lib/scaffold.js';

import { emitDocument } from './emit.js';

interface Options {
  name: string;
  slug: string;
  messageTtl?: string;
  file?: string;
  output?: string;
}

/** `borgiq scaffold canvas` — wrap actor(s) in the ExportedCanvasData envelope. */
export const scaffoldCanvas = async (options: Options): Promise<void> => {
  try {
    let actors: Record<string, unknown> = {};
    if (options.file) {
      actors = normalizeActorsInput(await readInput(options.file));
    } else if (!process.stdin.isTTY) {
      actors = normalizeActorsInput(await readInput());
    }

    const messageTtlInDays = options.messageTtl !== undefined ? Number(options.messageTtl) : undefined;
    if (messageTtlInDays !== undefined && (!Number.isInteger(messageTtlInDays) || messageTtlInDays <= 0)) {
      throw new Error('--message-ttl must be a positive integer (days).');
    }

    const doc = wrapCanvasEnvelope(actors, { name: options.name, slug: options.slug, messageTtlInDays });
    emitDocument(doc, options);
  } catch (error) {
    handleError(error);
  }
};
