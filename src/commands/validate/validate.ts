import fs from 'node:fs';

import { CliUsageError, ExitCode, handleError } from '../../lib/errors.js';
import { readTextInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { validateYaml, postProcess } from '../../lib/workflowValidation.js';

interface ValidateOptions {
  skipTypecheck?: boolean;
  postProcess?: boolean;
  inPlace?: boolean;
}

type ParentOpts = { parent: { opts: () => { json?: boolean } } };

export const validateAction = async (
  file: string | undefined,
  options: ValidateOptions,
  command: ParentOpts,
): Promise<void> => {
  try {
    const globalOpts = command.parent.opts();
    const content = await readTextInput(file);
    if (!content.trim()) {
      throw new CliUsageError('No YAML content provided. Pass a file path or pipe YAML via stdin.');
    }

    if (options.postProcess) {
      const result = postProcess(content);
      if (process.stderr.isTTY) {
        if (result.modified) {
          process.stderr.write('Post-processing complete:\n');
          for (const change of result.changes) process.stderr.write(`  - ${change}\n`);
        } else {
          process.stderr.write('No changes needed.\n');
        }
      }
      if (options.inPlace && file && file !== '-') {
        fs.writeFileSync(file, result.modified ? result.content : content, 'utf-8');
        if (process.stderr.isTTY) process.stderr.write(`File updated: ${file}\n`);
      } else {
        process.stdout.write(result.modified ? result.content : content);
      }
      return;
    }

    const result = await validateYaml(content, Boolean(options.skipTypecheck));

    if (!globalOpts.json && process.stderr.isTTY) {
      if (result.valid) {
        const actorCount = Object.keys(result.parsed?.actors ?? {}).length;
        process.stderr.write(`Valid. ${actorCount} actor(s).`);
        process.stderr.write(result.warnings.length ? ` ${result.warnings.length} warning(s).\n` : '\n');
      } else {
        process.stderr.write(`Invalid: ${result.errors.length} error(s), ${result.warnings.length} warning(s).\n`);
      }
    }

    if (!result.valid) {
      process.exitCode = ExitCode.USAGE;
    }
    // Emit { valid, errors, warnings } only — `parsed` is the entire workflow
    // and would bloat stdout; it's used only for the stderr actor count above.
    const { parsed: _parsed, ...publicResult } = result;
    void _parsed;
    output(publicResult, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
