import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandPath } from './config.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

function resolveExisting(inputPath) {
  if (!inputPath) throw new Error('path is required');
  const expanded = expandPath(inputPath);
  if (!fs.existsSync(expanded)) throw new Error(`Path does not exist: ${inputPath}`);
  return fs.realpathSync.native(expanded);
}

function metadata(realPath) {
  const stat = fs.statSync(realPath);
  return {
    path: realPath,
    name: path.basename(realPath) || realPath,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    extension: stat.isFile() ? path.extname(realPath).toLowerCase() : null,
  };
}

export function inspectPath(inputPath) {
  return metadata(resolveExisting(inputPath));
}

export function listPath(inputPath, depth = 1) {
  const realPath = resolveExisting(inputPath);
  if (!fs.statSync(realPath).isDirectory()) throw new Error('Path is not a directory');
  const maxDepth = Math.max(1, Math.min(Number(depth) || 1, 4));

  function walk(dir, currentDepth) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name !== '.DS_Store')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        const item = metadata(fs.realpathSync.native(fullPath));
        if (entry.isDirectory() && currentDepth < maxDepth) {
          item.children = walk(fullPath, currentDepth + 1);
        }
        return item;
      });
  }

  return { path: realPath, entries: walk(realPath, 1) };
}

async function readPdf(realPath, config) {
  const buffer = fs.readFileSync(realPath);
  const parsed = await pdfParse(buffer);
  const text = parsed.text || '';
  const maxChars = Math.max(config.maxReadBytes, 512 * 1024);
  const content = text.slice(0, maxChars);
  return {
    ...metadata(realPath),
    format: 'pdf',
    pages: parsed.numpages || null,
    info: parsed.info || null,
    textLength: text.length,
    truncated: content.length < text.length,
    content,
  };
}

function readText(realPath, config, start = 0, length) {
  const stat = fs.statSync(realPath);
  const maxBytes = config.maxReadBytes;
  const offset = Math.max(0, Number(start) || 0);
  const requested = length == null ? Math.min(stat.size - offset, maxBytes) : Number(length);
  const bytesToRead = Math.max(0, Math.min(requested, maxBytes, stat.size - offset));
  const fd = fs.openSync(realPath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, offset);
    const slice = buffer.subarray(0, bytesRead);
    if (slice.includes(0)) throw new Error('Binary file type is not supported yet');
    return {
      ...metadata(realPath),
      format: 'text',
      offset,
      bytesRead,
      truncated: offset + bytesRead < stat.size,
      content: slice.toString('utf8'),
    };
  } finally {
    fs.closeSync(fd);
  }
}

export async function readPath(config, inputPath, options = {}) {
  const realPath = resolveExisting(inputPath);
  const stat = fs.statSync(realPath);
  if (stat.isDirectory()) {
    return listPath(realPath, options.depth || 1);
  }
  if (!stat.isFile()) throw new Error('Unsupported path type');

  const ext = path.extname(realPath).toLowerCase();
  if (ext === '.pdf') return readPdf(realPath, config);
  return readText(realPath, config, options.start, options.length);
}

export function searchPath(config, inputPath, query, options = {}) {
  if (!query) throw new Error('query is required');
  const realPath = resolveExisting(inputPath);
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const results = [];
  const maxResults = Math.min(Number(options.maxResults) || 50, config.maxSearchResults);
  const maxFileBytes = Math.min(Number(options.maxFileBytes) || 1024 * 1024, 5 * 1024 * 1024);

  function scanFile(filePath) {
    if (results.length >= maxResults) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxFileBytes || path.extname(filePath).toLowerCase() === '.pdf') return;
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { return; }
    if (text.includes('\u0000')) return;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
      const haystack = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (haystack.includes(needle)) results.push({ path: filePath, line: i + 1, text: lines[i].slice(0, 1000) });
    }
  }

  function visit(currentPath) {
    if (results.length >= maxResults) return;
    const lst = fs.lstatSync(currentPath);
    if (lst.isSymbolicLink()) return;
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (results.length >= maxResults) break;
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        visit(path.join(currentPath, entry.name));
      }
    } else {
      scanFile(currentPath);
    }
  }

  visit(realPath);
  return { path: realPath, query, count: results.length, results };
}
