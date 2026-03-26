import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR_NAME = 'borgiq';
const CONFIG_FILE_NAME = 'config.json';

export const getConfigDir = (): string => {
  if (process.env.BORGIQ_CONFIG_DIR) {
    return process.env.BORGIQ_CONFIG_DIR;
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, CONFIG_DIR_NAME);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), CONFIG_DIR_NAME);
  }
  return path.join(os.homedir(), '.config', CONFIG_DIR_NAME);
};

export const getConfigFilePath = (): string => {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
};
