import { loadConfig } from '../config/index.js';

/**
 * Resolve the web app URL, used for OAuth2 handoff. Priority:
 *   1. --web-url flag
 *   2. BORGIQ_WEB_URL env var
 *   3. config.webUrl
 *   4. derived from apiUrl (strip /v1 path; replace leading `api.` with `app.`)
 */
export const resolveWebUrl = (flagWebUrl: string | undefined, apiUrl: string): string => {
  if (flagWebUrl) return stripTrailingSlash(flagWebUrl);
  if (process.env.BORGIQ_WEB_URL) return stripTrailingSlash(process.env.BORGIQ_WEB_URL);

  const config = loadConfig();
  if (config?.webUrl) return stripTrailingSlash(config.webUrl);

  return deriveWebUrlFromApiUrl(apiUrl);
};

/** Turn e.g. `https://api.borgiq.com/v1` into `https://app.borgiq.com`. */
export const deriveWebUrlFromApiUrl = (apiUrl: string): string => {
  try {
    const url = new URL(apiUrl);
    if (url.hostname.startsWith('api.')) {
      url.hostname = 'app.' + url.hostname.slice(4);
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return stripTrailingSlash(url.toString());
  } catch {
    return stripTrailingSlash(apiUrl);
  }
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');
