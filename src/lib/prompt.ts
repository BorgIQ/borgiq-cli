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

/** Prompt for a secret value without echoing characters. */
export const promptSecret = (question: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;
    stderr.write(`${question}: `);

    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let value = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          stderr.write('\n');
          resolve(value);
          return;
        } else if (ch === '\u0003') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          stderr.write('\n');
          reject(new Error('Interrupted'));
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
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
