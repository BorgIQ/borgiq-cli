import fs from 'node:fs';

import { stringifyYamlDoc } from '../../lib/bundle/yaml.js';
import { readBundleDir } from '../../lib/bundleFs.js';
import { handleError } from '../../lib/errors.js';
import { assembleOrFail } from './shared.js';

export const bundlePack = async (dir: string, options: { output?: string; strict?: boolean }): Promise<void> => {
  try {
    const { doc } = assembleOrFail(readBundleDir(dir), options.strict ?? false);
    const text = stringifyYamlDoc(doc);
    if (options.output) {
      fs.writeFileSync(options.output, text, 'utf-8');
      if (process.stderr.isTTY) process.stderr.write(`Packed ${dir} -> ${options.output}\n`);
      return;
    }
    process.stdout.write(text);
  } catch (error) {
    handleError(error);
  }
};
