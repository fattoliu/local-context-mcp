import fs from 'node:fs';
import path from 'node:path';
import { resolveRoot, resolveWithinRoot } from './config.js';

function projectNameFromDir(dirName) {
  return dirName.replace(/^-/, '/').replaceAll('-', '/');
}

function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (typeof item === 'string') return item;
    if (item?.type === 'text') return item.text || '';
    if (item?.type === 'tool_use') return `[tool_use:${item.name || 'unknown'}] ${JSON.stringify(item.input || {})}`;
    if (item?.type === 'tool_result') return `[tool_result] ${extractText(item.content)}`;
    return '';
  }).filter(Boolean).join('\n');
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const message = record.message || record;
  const role = message.role || record.type || 'unknown';
  const text = extractText(message.content ?? record.content);
  if (!text && !record.summary) return null;
  return {
    role,
    text: text || String(record.summary || ''),
    timestamp: record.timestamp || record.created_at || record.createdAt || null,
    uuid: record.uuid || record.id || null,
    parentUuid: record.parentUuid || record.parent_uuid || null,
  };
}

function assertSimpleId(value, label) {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`Invalid ${label}`);
  }
}

export function listClaudeProjects(projectsRoot) {
  const root = resolveRoot(projectsRoot);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        id: entry.name,
        projectPath: projectNameFromDir(entry.name),
        storagePath: fullPath,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function listClaudeSessions(projectsRoot, projectId) {
  assertSimpleId(projectId, 'projectId');
  const resolved = resolveWithinRoot(projectsRoot, projectId);
  if (!fs.statSync(resolved.path).isDirectory()) throw new Error('Invalid project');

  return fs.readdirSync(resolved.path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const fullPath = path.join(resolved.path, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        sessionId: entry.name.slice(0, -'.jsonl'.length),
        file: fullPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function readClaudeSession(projectsRoot, projectId, sessionId, limit = 500) {
  assertSimpleId(projectId, 'projectId');
  assertSimpleId(sessionId, 'sessionId');
  const relative = path.join(projectId, `${sessionId}.jsonl`);
  const resolved = resolveWithinRoot(projectsRoot, relative);
  if (!fs.statSync(resolved.path).isFile()) throw new Error('Invalid session');

  const records = fs.readFileSync(resolved.path, 'utf8').split(/\r?\n/).filter(Boolean).map(safeJson).filter(Boolean);
  const messages = records.map(normalizeRecord).filter(Boolean);
  const capped = messages.slice(-Math.max(1, Math.min(Number(limit) || 500, 2000)));
  return {
    root: resolved.root,
    projectId,
    sessionId,
    file: resolved.path,
    totalMessages: messages.length,
    returnedMessages: capped.length,
    messages: capped,
  };
}

export function searchClaudeHistory(projectsRoot, query, projectId, maxResults = 100) {
  if (!query) throw new Error('query is required');
  const root = resolveRoot(projectsRoot);
  const projects = projectId ? [{ id: projectId }] : listClaudeProjects(root);
  const needle = query.toLowerCase();
  const results = [];
  const cap = Math.max(1, Math.min(Number(maxResults) || 100, 500));

  for (const project of projects) {
    let sessions;
    try { sessions = listClaudeSessions(root, project.id); } catch { continue; }
    for (const session of sessions) {
      if (results.length >= cap) break;
      const lines = fs.readFileSync(session.file, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < cap; i += 1) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        const record = safeJson(lines[i]);
        const normalized = normalizeRecord(record);
        results.push({
          projectId: project.id,
          sessionId: session.sessionId,
          line: i + 1,
          role: normalized?.role || null,
          timestamp: normalized?.timestamp || null,
          text: normalized?.text?.slice(0, 2000) || lines[i].slice(0, 2000),
        });
      }
    }
  }

  return { root, query, count: results.length, results };
}
