import fs from 'node:fs';

interface EmitActorOptions {
  output?: string;
  printId?: boolean;
}

/**
 * Emit a scaffolded actor. By default JSON goes to stdout (or `--output`),
 * with the new id echoed to stderr so it's visible without polluting stdout.
 * `--print-id` prints ONLY the id to stdout (for `ID=$(borgiq scaffold …)`
 * capture) and routes the JSON to the file (or stderr if no `--output`).
 */
export const emitActor = (actor: { id: string }, opts: EmitActorOptions): void => {
  const json = JSON.stringify(actor, null, 2);
  if (opts.printId) {
    if (opts.output) fs.writeFileSync(opts.output, json + '\n');
    else process.stderr.write(json + '\n');
    process.stdout.write(actor.id + '\n');
    return;
  }
  if (opts.output) {
    fs.writeFileSync(opts.output, json + '\n');
    process.stderr.write(`Actor ${actor.id} written to ${opts.output}\n`);
  } else {
    process.stdout.write(json + '\n');
    process.stderr.write(`Actor ID: ${actor.id}\n`);
  }
};

/** Emit a non-actor document (canvas envelope / batch ops) to stdout or a file. */
export const emitDocument = (doc: unknown, opts: { output?: string }): void => {
  const json = JSON.stringify(doc, null, 2);
  if (opts.output) {
    fs.writeFileSync(opts.output, json + '\n');
    process.stderr.write(`Written to ${opts.output}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
};
