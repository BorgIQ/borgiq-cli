import { CliUsageError, handleError } from '../../lib/errors.js';
import { convertActorNameToMsgVar } from '../../lib/ids.js';

type ParentOpts = { parent: { parent: { opts: () => { json?: boolean } } } };

export const generateMsgvar = (nameParts: string[], _options: unknown, command: ParentOpts): void => {
  try {
    const globalOpts = command.parent.parent.opts();
    const name = (nameParts ?? []).join(' ');
    if (!name.trim()) {
      throw new CliUsageError('Provide an actor name, e.g. borgiq generate msgvar "Fetch user profile"');
    }
    const msgVar = convertActorNameToMsgVar(name);
    if (globalOpts.json) {
      process.stdout.write(JSON.stringify({ msgVar }) + '\n');
    } else {
      process.stdout.write(msgVar + '\n');
    }
  } catch (error) {
    handleError(error);
  }
};
