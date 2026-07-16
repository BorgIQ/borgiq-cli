import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { managedAssetEntries } from '../../lib/bundle/reactApp.js';
import { reactAppActors } from '../../lib/reactAppAssets.js';
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

    // unpack is offline by design; only asset references travel in an export document.
    const referencedAssets = reactAppActors(input.document)
      .reduce((total, actor) => total + managedAssetEntries(actor.configuration).length, 0);
    if (referencedAssets > 0) {
      process.stderr.write(`Note: ${referencedAssets} react-app asset file(s) are not materialized offline - run 'borgiq bundle pull' to download them.\n`);
    }

    process.stderr.write(`Unpacked ${actorCount(files)} actor(s) into ${dir}\n`);
  } catch (error) {
    handleError(error);
  }
};

const actorCount = (files: Record<string, string>): number =>
  Object.keys(files).filter((path) => path.endsWith('/actor.yaml')).length;
