import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.homedir(), '.local-context-mcp');
const PAIR_FILE = path.join(STATE_DIR, 'pairing.json');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function save(record) {
  ensureStateDir();
  fs.writeFileSync(PAIR_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

function load() {
  try { return JSON.parse(fs.readFileSync(PAIR_FILE, 'utf8')); } catch { return null; }
}

export function createPairingCode(ttlMinutes = 10) {
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  save({ hash: hash(code), expiresAt: Date.now() + ttlMinutes * 60_000, attemptsLeft: 8 });
  return { code, expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString() };
}

export function verifyPairingCode(code) {
  const record = load();
  if (!record) return { ok: false, reason: 'no_active_code' };
  if (Date.now() > record.expiresAt) {
    try { fs.unlinkSync(PAIR_FILE); } catch {}
    return { ok: false, reason: 'expired' };
  }
  const candidate = hash(String(code || '').trim().toUpperCase());
  const valid = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash));
  if (!valid) {
    record.attemptsLeft = Math.max(0, (record.attemptsLeft ?? 1) - 1);
    if (record.attemptsLeft === 0) {
      try { fs.unlinkSync(PAIR_FILE); } catch {}
      return { ok: false, reason: 'too_many_attempts' };
    }
    save(record);
    return { ok: false, reason: 'invalid', attemptsLeft: record.attemptsLeft };
  }
  try { fs.unlinkSync(PAIR_FILE); } catch {}
  return { ok: true };
}
