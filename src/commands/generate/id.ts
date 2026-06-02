import { CliUsageError, handleError } from '../../lib/errors.js';
import { Id, monotonicUlid } from '../../lib/ids.js';

type ParentOpts = { parent: { parent: { opts: () => { json?: boolean } } } };

const PREFIX_MAP: Record<string, string> = {
  actor: 'ACTR',
  edge: 'EDGE',
  template: 'ATMP',
  app: 'TAPP',
  category: 'TCTG',
  sourceport: 'SPRT',
  webhooktriggerkey: '',
};

export const generateId = (type: string, _options: unknown, command: ParentOpts): void => {
  try {
    const globalOpts = command.parent.parent.opts();
    const normalized = type.toLowerCase();
    const prefix = PREFIX_MAP[normalized];
    if (prefix === undefined) {
      throw new CliUsageError(`Invalid type: ${type}. Valid types: ${Object.keys(PREFIX_MAP).join(', ')}`);
    }

    let id: string;
    if (normalized === 'sourceport') {
      id = Id.createShortId(prefix);
    } else if (normalized === 'webhooktriggerkey') {
      id = monotonicUlid();
    } else {
      id = Id.create(prefix);
    }

    if (globalOpts.json) {
      process.stdout.write(JSON.stringify({ id }) + '\n');
    } else {
      process.stdout.write(id + '\n');
    }
  } catch (error) {
    handleError(error);
  }
};
