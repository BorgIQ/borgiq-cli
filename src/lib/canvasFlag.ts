import { Option, type Command } from 'commander';

import { CliUsageError } from './errors.js';
import { markExampleRequired } from './listOptions.js';

/** Flags produced by withCanvasOption(). */
export interface CanvasOptionFlags {
  canvas?: string;
  canvasId?: string;
}

/**
 * Registers the canvas-identifier flag on a command: the documented
 * `--canvas <canvas>` plus a hidden, deprecated `--canvas-id` alias kept for
 * backward compatibility.
 *
 * Neither flag is marked required at the Commander level — Commander can't
 * attach two long flags to one option, so presence is enforced in the handler
 * via resolveCanvasSlugOrId().
 */
export const withCanvasOption = (cmd: Command, description = 'Canvas slug or ID', valueName = 'canvas'): Command =>
  cmd
    .addOption(markExampleRequired(new Option(`--canvas <${valueName}>`, description)))
    .addOption(new Option(`--canvas-id <${valueName}>`, 'Deprecated alias for --canvas').hideHelp());

/** Resolves the canvas flag value, preferring --canvas; throws if neither was given. */
export const resolveCanvasSlugOrId = (options: CanvasOptionFlags): string => {
  const value = options.canvas ?? options.canvasId;
  if (!value) {
    throw new CliUsageError("required option '--canvas <canvas>' not specified");
  }
  return value;
};
