import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function expandPath(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

export function loadConfig() {
  return {
    host: process.env.LOCAL_CONTEXT_HOST || '127.0.0.1',
    port: Number(process.env.LOCAL_CONTEXT_PORT || 7331),
    publicBaseUrl: (process.env.LOCAL_CONTEXT_PUBLIC_URL || 'https://mcp.fatto.dpdns.org').replace(/\/$/, ''),
    maxReadBytes: Number(process.env.LOCAL_CONTEXT_MAX_READ_BYTES || 512 * 1024),
    maxSearchResults: Number(process.env.LOCAL_CONTEXT_MAX_SEARCH_RESULTS || 100),
  };
}

export function resolveRoot(root) {
  if (!root) throw new Error('root is required');
  const expanded = expandPath(root);
  if (!fs.existsSync(expanded)) throw new Error(`Root does not exist: ${root}`);
  const realRoot = fs.realpathSync.native(expanded);
  if (!fs.statSync(realRoot).isDirectory()) throw new Error(`Root is not a directory: ${root}`);
  return realRoot;
}

export function resolveWithinRoot(root, target = '.') {
  const realRoot = resolveRoot(root);
  const candidate = path.isAbsolute(target) ? expandPath(target) : path.resolve(realRoot, target);
  if (!fs.existsSync(candidate)) throw new Error(`Path does not exist: ${target}`);
  const realCandidate = fs.realpathSync.native(candidate);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path escapes root: ${target}`);
  }
  return { root: realRoot, path: realCandidate };
}
