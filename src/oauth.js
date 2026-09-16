import crypto from 'node:crypto';
import express from 'express';
import { AuthStore, pkceS256 } from './auth-store.js';
import { verifyPairingCode } from './pairing.js';

export const SUPPORTED_SCOPES = ['local.read', 'offline_access'];
const pending = new Map();

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function parseScopes(raw) {
  const requested = new Set(String(raw || '').split(/\s+/).filter(Boolean));
  const scopes = SUPPORTED_SCOPES.filter((scope) => requested.has(scope));
  return scopes.length ? scopes : ['local.read'];
}
function validRedirect(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}
function setSecurityHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

export function createOAuth({ publicBaseUrl }) {
  const router = express.Router();
  const store = new AuthStore();
  const base = publicBaseUrl.replace(/\/$/, '');
  const resource = `${base}/mcp`;

  const authMetadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SUPPORTED_SCOPES,
  };
  const resourceMetadata = {
    resource,
    authorization_servers: [base],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Local Context',
  };

  router.get('/.well-known/oauth-protected-resource', (_req, res) => res.json(resourceMetadata));
  router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json(resourceMetadata));
  router.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(authMetadata));
  router.get('/.well-known/oauth-authorization-server/mcp', (_req, res) => res.json(authMetadata));
  router.get('/.well-known/openid-configuration', (_req, res) => res.json(authMetadata));

  router.post('/oauth/register', express.json(), (req, res) => {
    const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
    if (!redirectUris.length || !redirectUris.every((uri) => typeof uri === 'string' && validRedirect(uri))) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }
    const client = store.registerClient({ clientName: req.body?.client_name, redirectUris });
    res.status(201).json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  router.get('/oauth/authorize', (req, res) => {
    const q = req.query;
    const client = store.getClient(q.client_id);
    if (!client || !client.redirectUris.includes(q.redirect_uri) || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) {
      setSecurityHeaders(res);
      res.status(400).send('Invalid OAuth request');
      return;
    }

    const id = crypto.randomBytes(16).toString('hex');
    pending.set(id, {
      clientId: q.client_id,
      redirectUri: q.redirect_uri,
      state: q.state,
      codeChallenge: q.code_challenge,
      scopes: parseScopes(q.scope),
      resource: q.resource,
      expiresAt: Date.now() + 10 * 60_000,
    });

    setSecurityHeaders(res);
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Local Context</title><style>body{font-family:-apple-system,sans-serif;max-width:440px;margin:12vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;font-size:16px}code{background:#eee;padding:2px 5px}</style><h2>Connect ChatGPT</h2><p>Run <code>npm run pair</code> on this Mac, then enter the one-time code below.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${esc(id)}"><input name="pairing_code" placeholder="XXXX-XXXX" required autofocus><button>Authorize</button></form>`);
  });

  router.post('/oauth/authorize', express.urlencoded({ extended: false }), (req, res) => {
    const request = pending.get(req.body?.request_id);
    if (!request || request.expiresAt < Date.now()) {
      setSecurityHeaders(res);
      res.status(400).send('Authorization request expired');
      return;
    }
    const verdict = verifyPairingCode(req.body?.pairing_code);
    if (!verdict.ok) {
      setSecurityHeaders(res);
      res.status(401).send(`Pairing failed: ${esc(verdict.reason)}`);
      return;
    }

    pending.delete(req.body.request_id);
    const code = store.createCode(request);
    const url = new URL(request.redirectUri);
    url.searchParams.set('code', code);
    if (request.state) url.searchParams.set('state', request.state);
    res.redirect(url.toString());
  });

  router.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), (req, res) => {
    const body = req.body || {};
    if (body.grant_type === 'authorization_code') {
      const record = store.consumeCode(body.code || '');
      if (!record || record.clientId !== body.client_id || (body.redirect_uri && record.redirectUri !== body.redirect_uri) || pkceS256(body.code_verifier || '') !== record.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      const tokens = store.issueTokens({ clientId: body.client_id, scopes: record.scopes });
      res.json({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_type: 'Bearer', expires_in: tokens.expiresIn, scope: tokens.scopes.join(' ') });
      return;
    }

    if (body.grant_type === 'refresh_token') {
      const tokens = store.refresh(body.refresh_token, body.client_id);
      if (!tokens) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      res.json({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_type: 'Bearer', expires_in: tokens.expiresIn, scope: tokens.scopes.join(' ') });
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  router.post('/oauth/revoke', express.urlencoded({ extended: false }), (req, res) => {
    if (req.body?.token) store.revoke(req.body.token);
    res.status(200).json({});
  });

  return { router, store };
}
