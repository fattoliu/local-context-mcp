import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.homedir(), '.local-context-mcp');
const STORE_FILE = path.join(STATE_DIR, 'auth.json');
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
const CODE_TTL = 10 * 60_000;

function ensureDir() { fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

export class AuthStore {
  constructor() { this.data = this.load(); }
  load() {
    try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
    catch { return { clients: {}, codes: {}, access: {}, refresh: {} }; }
  }
  save() {
    ensureDir();
    fs.writeFileSync(STORE_FILE, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
  }
  registerClient({ clientName, redirectUris }) {
    const clientId = `lc_${token(18)}`;
    this.data.clients[clientId] = { clientId, clientName, redirectUris, createdAt: Date.now() };
    this.save();
    return this.data.clients[clientId];
  }
  getClient(clientId) { return this.data.clients[clientId]; }
  createCode(record) {
    const raw = token(24);
    this.data.codes[digest(raw)] = { ...record, expiresAt: Date.now() + CODE_TTL };
    this.save();
    return raw;
  }
  consumeCode(raw) {
    const key = digest(raw);
    const record = this.data.codes[key];
    delete this.data.codes[key];
    this.save();
    if (!record || record.expiresAt < Date.now()) return null;
    return record;
  }
  issueTokens({ clientId, scopes }) {
    const accessToken = token(32);
    const refreshToken = token(32);
    this.data.access[digest(accessToken)] = { clientId, scopes, expiresAt: Date.now() + ACCESS_TTL };
    this.data.refresh[digest(refreshToken)] = { clientId, scopes, expiresAt: Date.now() + REFRESH_TTL };
    this.save();
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL / 1000, scopes };
  }
  verifyAccessToken(raw) {
    const record = this.data.access[digest(raw || '')];
    if (!record || record.expiresAt < Date.now()) return null;
    return record;
  }
  refresh(raw, clientId) {
    const key = digest(raw || '');
    const record = this.data.refresh[key];
    if (!record || record.expiresAt < Date.now() || record.clientId !== clientId) return null;
    delete this.data.refresh[key];
    this.save();
    return this.issueTokens({ clientId, scopes: record.scopes });
  }
  revoke(raw) {
    const key = digest(raw || '');
    delete this.data.access[key];
    delete this.data.refresh[key];
    this.save();
  }
}

export function pkceS256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}
