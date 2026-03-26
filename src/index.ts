#!/usr/bin/env node
import { createProgram } from './program.js';
import { handleError } from './lib/errors.js';

const main = async (): Promise<void> => {
  const program = createProgram();
  await program.parseAsync(process.argv);
};

main().catch(handleError);
