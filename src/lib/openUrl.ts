import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

/**
 * Open a URL in the user's default browser using the platform-native opener.
 * Silent — any error is swallowed; callers should always print the URL too
 * as a fallback.
 */
export const openUrl = (url: string): void => {
  let command: string;
  let args: string[];
  let opts: SpawnOptions = { stdio: 'ignore', detached: true };

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      // Go through the shell so cmd.exe parses `start "" "url"` correctly.
      // The empty "" is the window title slot — `start` otherwise treats
      // a quoted first argument as the title and fails to open the URL.
      command = `start "" ${JSON.stringify(url)}`;
      args = [];
      opts = { ...opts, shell: true };
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  try {
    const child = spawn(command, args, opts);
    child.on('error', () => { /* ignore */ });
    child.unref();
  } catch {
    // ignore — caller should print the URL as a fallback
  }
};
