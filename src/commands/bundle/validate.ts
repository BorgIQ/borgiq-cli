import { validateBundle } from '../../lib/bundle/validate.js';
import { readBundleDirDetailed } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { reportIssues, skippedFileIssues } from './shared.js';

export const bundleValidate = async (
  dir: string,
  options: { strict?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const contents = readBundleDirDetailed(dir);
    const { errors, warnings } = validateBundle(contents.files, {
      localAssetPaths: contents.assets.map((asset) => asset.bundlePath),
    });
    warnings.push(...skippedFileIssues(contents.skipped));
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
