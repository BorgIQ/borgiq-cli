import type { Command } from 'commander';

import { validateAction } from './validate.js';

export const registerValidateCommands = (program: Command): void => {
  program
    .command('validate [file]')
    .description('Validate a BorgIQ workflow YAML file (offline). Reads stdin when no file is given.')
    .option('--skip-typecheck', 'Skip Deno/Python code typechecking for DenoActor/PythonActor code')
    .option('--post-process', 'Clean up unnecessary fields instead of validating (emits cleaned YAML)')
    .option('-i, --in-place', 'With --post-process, modify the file in place')
    .addHelpText(
      'after',
      `
Examples:
  $ borgiq validate flow.yaml
  $ borgiq validate flow.yaml --skip-typecheck
  $ cat flow.yaml | borgiq validate
  $ borgiq validate flow.yaml --post-process --in-place`,
    )
    .action(validateAction);
};
