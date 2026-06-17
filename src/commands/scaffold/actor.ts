import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { buildCanvasActor } from '../../lib/scaffold.js';
import type { BIQActorSchema } from '../../client/types.js';

import { emitActor } from './emit.js';

interface ScaffoldActorOptions {
  type: string;
  name: string;
  routes?: string;
  output?: string;
  printId?: boolean;
}

type ParentOpts = { parent: { parent: { opts: () => GlobalOptions } } };

/** `borgiq scaffold actor` — build a CanvasActor from the platform schema. */
export const scaffoldActor = async (options: ScaffoldActorOptions, command: ParentOpts): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const schema = (await client.getActorSchema(options.type)) as BIQActorSchema;
    if (!schema || !schema.actorType) {
      throw new CliUsageError(`Unknown actor type: ${options.type}. Run 'borgiq actors list' to see valid types.`);
    }

    const routes = options.routes
      ? options.routes.split(',').map((r) => r.trim()).filter(Boolean)
      : undefined;
    if (routes && schema.sourcePorts.type !== 'dynamic') {
      throw new CliUsageError(
        `--routes is only valid for actors with dynamic ports (e.g. RouterActor); ${schema.actorType} does not support added ports.`,
      );
    }

    const actor = buildCanvasActor(schema, { name: options.name, routes });
    emitActor(actor, options);
  } catch (error) {
    handleError(error, { json: command.parent.parent.opts().json });
  }
};
