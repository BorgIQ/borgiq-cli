import { spawn } from 'node:child_process';

/**
 * Open a URL in the user's default browser using the platform-native opener.
 * Silent — any error is swallowed; callers should always print the URL too as a fallback.
 */
export const openUrl = (url: string): void => {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '""', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* ignore */ });
    child.unref();
  } catch {
    // ignore — caller should print the URL as a fallback
  }
};
