import crypto from 'node:crypto';
import express from 'express';
import { AuthStore, pkceS256 } from './auth-store.js';
import { verifyPairingCode } from './pairing.js';

const SCOPES = ['local.read', 'offline_access'];
const pending = new Map();

function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function parseScopes(raw) { const set = new Set(String(raw || '').split(/\s+/).filter(Boolean)); return SCOPES.filter((s) => set.has(s)); }
function validRedirect(uri) { try { const u = new URL(uri); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname)); } catch { return false; } }

export function createOAuth({ publicBaseUrl }) {
  const router = express.Router();
  const store = new AuthStore();
  const base = publicBaseUrl.replace(/\/$/, '');
  const resource = `${base}/mcp`;

  router.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource, authorization_servers: [base], scopes_supported: SCOPES, bearer_methods_supported: ['header'] }));
  router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json({ resource, authorization_servers: [base], scopes_supported: SCOPES, bearer_methods_supported: ['header'] }));
  router.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: SCOPES }));
  router.get('/.well-known/oauth-authorization-server/mcp', (_req, res) => res.redirect('/.well-known/oauth-authorization-server'));

  router.post('/oauth/register', express.json(), (req, res) => {
    const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
    if (!redirectUris.length || !redirectUris.every((u) => typeof u === 'string' && validRedirect(u))) return res.status(400).json({ error: 'invalid_redirect_uri' });
    const client = store.registerClient({ clientName: req.body?.client_name, redirectUris });
    res.status(201).json({ client_id: client.clientId, client_name: client.clientName, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] });
  });

  router.get('/oauth/authorize', (req, res) => {
    const q = req.query;
    const client = store.getClient(q.client_id);
    if (!client || !client.redirectUris.includes(q.redirect_uri) || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) return res.status(400).send('Invalid OAuth request');
    const id = crypto.randomBytes(16).toString('hex');
    pending.set(id, { clientId: q.client_id, redirectUri: q.redirect_uri, state: q.state, codeChallenge: q.code_challenge, scopes: parseScopes(q.scope), expiresAt: Date.now() + 10 * 60_000 });
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>local-context-mcp</title><style>body{font-family:-apple-system,sans-serif;max-width:440px;margin:12vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;font-size:16px}code{background:#eee;padding:2px 5px}</style><h2>Connect ChatGPT</h2><p>Run <code>npm run pair</code> on this Mac, then enter the one-time code below.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${esc(id)}"><input name="pairing_code" placeholder="XXXX-XXXX" required autofocus><button>Authorize</button></form>`);
  });

  router.post('/oauth/authorize', express.urlencoded({ extended: false }), (req, res) => {
    const request = pending.get(req.body?.request_id);
    if (!request || request.expiresAt < Date.now()) return res.status(400).send('Authorization request expired');
    const verdict = verifyPairingCode(req.body?.pairing_code);
    if (!verdict.ok) return res.status(401).send(`Pairing failed: ${esc(verdict.reason)}`);
    pending.delete(req.body.request_id);
    const code = store.createCode(request);
    const url = new URL(request.redirectUri); url.searchParams.set('code', code); if (request.state) url.searchParams.set('state', request.state); url.searchParams.set('iss', base); res.redirect(url.toString());
  });

  router.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
    const b = req.body || {};
    if (b.grant_type === 'authorization_code') {
      const record = store.consumeCode(b.code || '');
      if (!record || record.clientId !== b.client_id || record.redirectUri !== b.redirect_uri || pkceS256(b.code_verifier || '') !== record.codeChallenge) return res.status(400).json({ error: 'invalid_grant' });
      const t = store.issueTokens({ clientId: b.client_id, scopes: record.scopes.length ? record.scopes : ['local.read'] });
      return res.json({ access_token: t.accessToken, refresh_token: t.refreshToken, token_type: 'Bearer', expires_in: t.expiresIn, scope: t.scopes.join(' ') });
    }
    if (b.grant_type === 'refresh_token') {
      const t = store.refresh(b.refresh_token, b.client_id); if (!t) return res.status(400).json({ error: 'invalid_grant' });
      return res.json({ access_token: t.accessToken, refresh_token: t.refreshToken, token_type: 'Bearer', expires_in: t.expiresIn, scope: t.scopes.join(' ') });
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  router.post('/oauth/revoke', express.urlencoded({ extended: false }), (req, res) => { if (req.body?.token) store.revoke(req.body.token); res.status(200).end(); });

  function requireAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const auth = match ? store.verifyAccessToken(match[1]) : null;
    if (!auth) {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.oauth = auth;
    next();
  }

  return { router, requireAuth };
}
