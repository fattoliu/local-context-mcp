import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function normalizeRoot(value) {
  const expanded = expandHome(value);
  return fs.realpathSync.native(expanded);
}

export function loadConfig() {
  const rawRoots = (process.env.LOCAL_CONTEXT_ROOTS || '~/.claude/projects')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);

  const roots = rawRoots.map(normalizeRoot);

  return {
    host: process.env.LOCAL_CONTEXT_HOST || '127.0.0.1',
    port: Number(process.env.LOCAL_CONTEXT_PORT || 7331),
    roots,
    claudeProjectsRoot: normalizeRoot(process.env.CLAUDE_PROJECTS_ROOT || '~/.claude/projects'),
    maxReadBytes: Number(process.env.LOCAL_CONTEXT_MAX_READ_BYTES || 512 * 1024),
    maxSearchResults: Number(process.env.LOCAL_CONTEXT_MAX_SEARCH_RESULTS || 100),
  };
}

export function isPathInsideRoots(candidatePath, roots) {
  const realCandidate = fs.realpathSync.native(candidatePath);
  return roots.some((root) => realCandidate === root || realCandidate.startsWith(`${root}${path.sep}`));
}

export function resolveAllowedPath(inputPath, roots) {
  const candidate = expandHome(inputPath);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Path does not exist: ${inputPath}`);
  }
  const realCandidate = fs.realpathSync.native(candidate);
  if (!isPathInsideRoots(realCandidate, roots)) {
    throw new Error(`Path is outside configured roots: ${inputPath}`);
  }
  return realCandidate;
}
