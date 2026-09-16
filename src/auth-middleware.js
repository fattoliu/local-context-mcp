export function bearerAuth({ store, getBaseUrl }) {
  return (req, res, next) => {
    const challenge = (error, description) =>
      `Bearer realm="local-context", error="${error}", error_description="${description}", resource_metadata="${getBaseUrl(req)}/.well-known/oauth-protected-resource/mcp"`;

    const header = req.headers.authorization || '';
    if (!header.toLowerCase().startsWith('bearer ')) {
      res.status(401)
        .set('WWW-Authenticate', challenge('invalid_token', 'Missing bearer token'))
        .json({ error: 'unauthorized', error_description: 'Authentication required' });
      return;
    }

    const token = header.slice(7).trim();
    const record = store.verifyAccessToken(token);
    if (!record) {
      res.status(401)
        .set('WWW-Authenticate', challenge('invalid_token', 'Token invalid or expired'))
        .json({ error: 'unauthorized', error_description: 'Token invalid or expired' });
      return;
    }

    req.auth = {
      token,
      clientId: record.clientId,
      scopes: record.scopes || [],
      expiresAt: Math.floor(record.expiresAt / 1000),
    };
    next();
  };
}
