import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import { handleError } from '../../lib/errors.js';
import { bundleCompanions, readRawInput } from './shared.js';

export const bundleUnpack = async (file: string, dir: string, options: { force?: boolean }): Promise<void> => {
  try {
    const input = parseExportInput(await readRawInput(file));
    const { files, warnings } = disassemble(input.document, { exportErrors: input.exportErrors });
    writeBundleDir(dir, files, { force: options.force, createIfMissing: bundleCompanions(input.document) });

    for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
    if (input.exportErrors.length > 0) {
      process.stderr.write(`Warning: export reported ${input.exportErrors.length} actor error(s) - see exportErrors in canvas.yaml.\n`);
    }
    process.stderr.write(`Unpacked ${actorCount(files)} actor(s) into ${dir}\n`);
  } catch (error) {
    handleError(error);
  }
};

const actorCount = (files: Record<string, string>): number =>
  Object.keys(files).filter((path) => path.endsWith('/actor.yaml')).length;
