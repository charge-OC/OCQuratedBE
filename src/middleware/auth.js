// this will make sure its safe: protecting /api/* endpoints with api key or basic auth

// checking that incoming requests have a valid api key or basic auth credentials
export function authenticateApi(req, res, next) {
  // letting options requests pass through for browser pre-flight checks
  if (req.method === 'OPTIONS') {
    return next();
  }

  // this will make sure its safe: fail closed if server auth credentials are not configured
  const expectedApiKey = process.env.API_KEY ? process.env.API_KEY.trim() : '';
  const expectedUser = process.env.API_AUTH_USER ? process.env.API_AUTH_USER.trim() : '';
  const expectedPass = process.env.API_AUTH_PASS ? process.env.API_AUTH_PASS.trim() : '';

  const hasApiKey = Boolean(expectedApiKey);
  const hasBasicAuth = Boolean(expectedUser && expectedPass);

  // fail closed with 500 if server environment is missing required authentication secrets
  if (!hasApiKey && !hasBasicAuth) {
    return res.status(500).json({
      error: 'Server authentication misconfiguration'
    });
  }

  // 1. check for custom header x-api-key
  const apiKeyHeader = req.headers['x-api-key'];
  if (hasApiKey && apiKeyHeader && apiKeyHeader === expectedApiKey) {
    return next();
  }

  // 2. check for authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    // bearer token format
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (hasApiKey && token === expectedApiKey) {
        return next();
      }
    }

    // basic auth format
    if (authHeader.startsWith('Basic ') && hasBasicAuth) {
      const b64 = authHeader.slice(6).trim();
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        const [user, pass] = decoded.split(':');
        if (user === expectedUser && pass === expectedPass) {
          return next();
        }
      } catch {
        // ignore decoding errors and fall through to 401
      }
    }
  }

  // rejecting unauthenticated requests
  return res.status(401).json({
    error: 'Unauthorized: Valid API key (x-api-key or Bearer token) or Basic Auth required.'
  });
}
