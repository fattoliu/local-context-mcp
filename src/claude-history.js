import fs from 'node:fs';
import path from 'node:path';

function projectNameFromDir(dirName) {
  return dirName.replace(/^-/, '/').replaceAll('-', '/');
}

function assertSimpleId(value, label) {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`Invalid ${label}`);
  }
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

export function listClaudeProjects(config) {
  return fs.readdirSync(config.claudeProjectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(config.claudeProjectsRoot, entry.name);
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

export function listClaudeSessions(config, projectId) {
  assertSimpleId(projectId, 'projectId');
  const projectDir = path.join(config.claudeProjectsRoot, projectId);
  const realProjectDir = fs.realpathSync.native(projectDir);
  if (!realProjectDir.startsWith(`${config.claudeProjectsRoot}${path.sep}`)) throw new Error('Invalid project');

  return fs.readdirSync(realProjectDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const fullPath = path.join(realProjectDir, entry.name);
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

export function readClaudeSession(config, projectId, sessionId, limit = 500) {
  assertSimpleId(projectId, 'projectId');
  assertSimpleId(sessionId, 'sessionId');
  const file = path.join(config.claudeProjectsRoot, projectId, `${sessionId}.jsonl`);
  const realFile = fs.realpathSync.native(file);
  const expectedProjectDir = fs.realpathSync.native(path.join(config.claudeProjectsRoot, projectId));
  if (!realFile.startsWith(`${expectedProjectDir}${path.sep}`)) throw new Error('Invalid session');

  const records = fs.readFileSync(realFile, 'utf8').split(/\r?\n/).filter(Boolean).map(safeJson).filter(Boolean);
  const messages = records.map(normalizeRecord).filter(Boolean);
  const capped = messages.slice(-Math.max(1, Math.min(Number(limit) || 500, 2000)));
  return {
    projectId,
    sessionId,
    file: realFile,
    totalMessages: messages.length,
    returnedMessages: capped.length,
    messages: capped,
  };
}

export function searchClaudeHistory(config, query, projectId, maxResults = 100) {
  if (!query) throw new Error('query is required');
  if (projectId) assertSimpleId(projectId, 'projectId');
  const projects = projectId ? [{ id: projectId }] : listClaudeProjects(config);
  const needle = query.toLowerCase();
  const results = [];
  const cap = Math.max(1, Math.min(Number(maxResults) || 100, 500));

  for (const project of projects) {
    let sessions;
    try { sessions = listClaudeSessions(config, project.id); } catch { continue; }
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

  return { query, count: results.length, results };
}
