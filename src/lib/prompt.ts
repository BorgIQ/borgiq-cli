import readline from 'node:readline';

/** Prompt for a free-text answer on stderr. Returns the default when the user hits Enter. */
export const prompt = (question: string, defaultValue?: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
};

/** Prompt for a required free-text answer — loops until the user provides a non-empty value. */
export const promptRequired = async (question: string): Promise<string> => {
  while (true) {
    const value = await prompt(question);
    if (value) return value;
    process.stderr.write('A value is required.\n');
  }
};

/**
 * Prompt for a secret value without echoing characters.
 *
 * Requires an interactive TTY — throws immediately if stdin is a pipe,
 * since a non-TTY stdin would hang forever waiting for raw-mode input.
 *
 * Uses raw mode (bypassing readline) so typed characters are not echoed to
 * the terminal. The prior raw state is captured and restored so subsequent
 * readline-based prompts on the same stdin keep working.
 */
export const promptSecret = (question: string): Promise<string> => {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('promptSecret requires an interactive terminal'));
  }

  return new Promise((resolve, reject) => {
    const stderr = process.stderr;
    stderr.write(`${question}: `);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    let done = false;

    const cleanup = (): void => {
      if (done) return;
      done = true;
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      stdin.removeListener('close', onEnd);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stderr.write('\n');
    };

    const onData = (chunk: string): void => {
      // Drop escape-sequence chunks entirely (arrow keys, function keys, etc.)
      // rather than letting their bytes corrupt the secret. A properly-raw
      // terminal delivers the full ESC sequence in a single chunk, so this
      // is a pragmatic filter that keeps backspace/enter/Ctrl-C working.
      if (chunk.charCodeAt(0) === 0x1b) return;

      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          cleanup();
          resolve(value);
          return;
        } else if (ch === '\u0003') {
          cleanup();
          reject(new Error('Interrupted'));
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) value = value.slice(0, -1);
        } else if (ch >= ' ') {
          value += ch;
        }
        // Any other control character (< 0x20) is silently dropped.
      }
    };

    const onEnd = (): void => {
      cleanup();
      reject(new Error('Input stream ended before secret was provided'));
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('close', onEnd);
    stdin.once('error', onError);
  });
};

/** Prompt the user to pick one item from a list. Shows a numbered menu on stderr. */
export const promptChoice = async (question: string, choices: { label: string; value: string }[]): Promise<string> => {
  if (choices.length === 0) throw new Error('promptChoice called with no choices');
  process.stderr.write(`${question}\n`);
  choices.forEach((c, i) => {
    process.stderr.write(`  ${i + 1}) ${c.label}\n`);
  });
  while (true) {
    const answer = await prompt(`Select [1-${choices.length}]`, '1');
    const idx = parseInt(answer, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= choices.length) {
      return choices[idx - 1].value;
    }
    process.stderr.write('Invalid selection, try again.\n');
  }
};

/** Yes/no confirmation prompt. Default is returned on empty input. */
export const promptConfirm = async (question: string, defaultValue = false): Promise<boolean> => {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await prompt(`${question} [${suffix}]`)).toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
};
