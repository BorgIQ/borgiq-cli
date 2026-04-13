import fs from 'node:fs';
import path from 'node:path';

import { getConfigDir, getConfigFilePath } from './paths.js';

export interface CliConfig {
  /** The BorgIQ API base URL (e.g., https://api.borgiq.com/v1) */
  apiUrl: string;
  /** The API token (biq_...) */
  apiToken: string;
  /** Default org slug or ID */
  defaultOrg?: string;
  /** Default workspace slug or ID */
  defaultWorkspace?: string;
  /** Optional web app URL used for OAuth2 connection creation handoff. If omitted, derived from apiUrl. */
  webUrl?: string;
}

export const loadConfig = (): CliConfig | null => {
  const configPath = getConfigFilePath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
};

export const saveConfig = (config: CliConfig): void => {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = getConfigFilePath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
};

export const deleteConfig = (): boolean => {
  const configPath = getConfigFilePath();
  try {
    fs.unlinkSync(configPath);
    return true;
  } catch {
    return false;
  }
};

export const configExists = (): boolean => {
  return fs.existsSync(getConfigFilePath());
};

export { getConfigDir, getConfigFilePath } from './paths.js';
