import fs from 'node:fs';
import path from 'node:path';

import { buildStarterBundle } from '../../lib/bundle/template.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { BUNDLE_COMPANIONS } from './shared.js';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const bundleInit = async (dir: string, options: { name?: string; slug?: string }): Promise<void> => {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      throw new CliUsageError(`${dir} already exists and is not empty - init needs a fresh directory.`);
    }

    const base = path.basename(path.resolve(dir)).replace(/\.borgiq-canvas$/, '');
    const slug = options.slug ?? slugify(base);
    if (!SLUG_PATTERN.test(slug) || slug.length < 2) {
      throw new CliUsageError(`Invalid slug '${slug}' - use lowercase letters, digits, and hyphens (or pass --slug).`);
    }

    const name = options.name ?? base;
    const files = buildStarterBundle({ name, slug });
    writeBundleDir(dir, files, { createIfMissing: BUNDLE_COMPANIONS });
    process.stderr.write(`Initialized canvas bundle '${slug}' in ${dir}\n`);
  } catch (error) {
    handleError(error);
  }
};

const slugify = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
