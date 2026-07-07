import { validateBundle } from '../../lib/bundle/validate.js';
import { readBundleDir } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { reportIssues } from './shared.js';

export const bundleValidate = async (
  dir: string,
  options: { strict?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { errors, warnings } = validateBundle(readBundleDir(dir));
    const valid = errors.length === 0 && (!options.strict || warnings.length === 0);

    if (globalOpts.json || !process.stdout.isTTY) {
      output({ valid, errors, warnings }, globalOpts);
    } else {
      reportIssues(errors, warnings);
      process.stderr.write(valid ? `Bundle is valid (${warnings.length} warning(s)).\n` : 'Bundle is invalid.\n');
    }

    if (!valid) process.exitCode = ExitCode.USAGE;
  } catch (error) {
    handleError(error);
  }
};
