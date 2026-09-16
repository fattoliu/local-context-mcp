import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedPath } from './config.js';

function statEntry(fullPath, name) {
  const stat = fs.statSync(fullPath);
  return {
    name,
    path: fullPath,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function listRoots(config) {
  return config.roots.map((root) => statEntry(root, path.basename(root) || root));
}

export function listDirectory(config, inputPath, depth = 1) {
  const rootPath = resolveAllowedPath(inputPath, config.roots);
  const maxDepth = Math.max(0, Math.min(Number(depth) || 1, 4));

  function walk(dir, currentDepth) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name !== '.DS_Store')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        const item = statEntry(fullPath, entry.name);
        if (entry.isDirectory() && currentDepth < maxDepth) {
          item.children = walk(fullPath, currentDepth + 1);
        }
        return item;
      });
  }

  return { path: rootPath, entries: walk(rootPath, 1) };
}

export function readFile(config, inputPath, start = 0, length) {
  const filePath = resolveAllowedPath(inputPath, config.roots);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Path is not a file');

  const maxBytes = config.maxReadBytes;
  const offset = Math.max(0, Number(start) || 0);
  const requested = length == null ? Math.min(stat.size - offset, maxBytes) : Number(length);
  const bytesToRead = Math.max(0, Math.min(requested, maxBytes, stat.size - offset));
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, offset);
    return {
      path: filePath,
      size: stat.size,
      offset,
      bytesRead,
      truncated: offset + bytesRead < stat.size,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function searchFiles(config, query, root, options = {}) {
  if (!query) throw new Error('query is required');
  const searchRoot = resolveAllowedPath(root || config.roots[0], config.roots);
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const results = [];
  const maxResults = Math.min(Number(options.maxResults) || 50, config.maxSearchResults);
  const maxFileBytes = Math.min(Number(options.maxFileBytes) || 1024 * 1024, 5 * 1024 * 1024);

  function visit(currentPath) {
    if (results.length >= maxResults) return;
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (results.length >= maxResults) break;
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        visit(path.join(currentPath, entry.name));
      }
      return;
    }
    if (!stat.isFile() || stat.size > maxFileBytes) return;

    let text;
    try {
      text = fs.readFileSync(currentPath, 'utf8');
    } catch {
      return;
    }
    if (text.includes('\u0000')) return;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
      const haystack = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (haystack.includes(needle)) {
        results.push({ path: currentPath, line: i + 1, text: lines[i].slice(0, 1000) });
      }
    }
  }

  visit(searchRoot);
  return { root: searchRoot, query, count: results.length, results };
}
