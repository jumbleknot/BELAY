// The four settings, read once at startup (data-model.md Configuration; spec FR-004). In the bundle
// they come from Claude Desktop's user_config through mcp_config.env. A missing or invalid value stops
// the server with an error naming the variable, and the token's value is never part of any message.
//
// The PDLC_* names are an external contract shared with manifest.json; renaming one breaks every
// installed extension.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export class ConfigError extends Error {
  /** @param {string} variable @param {string} reason */
  constructor(variable, reason) {
    super(`${variable} ${reason}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

const OWNER_CHARS = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const required = (env, variable) => {
  const v = env[variable];
  if (typeof v !== 'string' || v.trim() === '') throw new ConfigError(variable, 'is not set');
  return v.trim();
};

function forgeUrlFrom(env) {
  const variable = 'PDLC_FORGE_URL';
  const raw = required(env, variable);
  let url;
  try { url = new URL(raw); } catch { throw new ConfigError(variable, 'is not a URL'); }
  // Checked before anything that could echo the value: a URL with userinfo may hold a credential.
  if (url.username || url.password) throw new ConfigError(variable, 'must not contain userinfo (user:password@)');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError(variable, `must be an http:// or https:// URL, not ${url.protocol}`);
  if (url.pathname !== '/' || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new ConfigError(variable, 'must be the forge root, with no path, query or fragment');
  }
  return `${url.protocol}//${url.host}`;
}

function cloneRootFrom(env) {
  const variable = 'PDLC_CLONE_ROOT';
  const path = required(env, variable);
  if (!isAbsolute(path)) throw new ConfigError(variable, 'must be an absolute path');
  let stat;
  try { stat = statSync(path); } catch { throw new ConfigError(variable, 'does not exist'); }
  if (!stat.isDirectory()) throw new ConfigError(variable, 'is not a directory');
  return path;
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {Readonly<{forgeUrl: string, owner: string, token: string, cloneRoot: string, apiBase: string}>}
 */
export function loadConfig(env) {
  const forgeUrl = forgeUrlFrom(env);
  const owner = required(env, 'PDLC_FORGE_OWNER');
  if (!OWNER_CHARS.test(owner)) throw new ConfigError('PDLC_FORGE_OWNER', 'must be a forge user name (letters, digits, "-", "_", ".")');
  const token = required(env, 'PDLC_FORGE_TOKEN');
  const cloneRoot = cloneRootFrom(env);
  return Object.freeze({ forgeUrl, owner, token, cloneRoot, apiBase: `${forgeUrl}/api/v1` });
}
