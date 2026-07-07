// Optional OIDC login (Authentik, Authelia, Keycloak, Pocket ID, ...).
// Enabled when OIDC_ISSUER_URL + OIDC_CLIENT_ID are set; otherwise the app
// runs open (put it behind reverse-proxy auth or a VPN in that case).
//
//   OIDC_ISSUER_URL   e.g. https://auth.example.com/application/o/trip/
//   OIDC_CLIENT_ID    client id registered with your IdP
//   OIDC_CLIENT_SECRET  client secret (omit for a public client with PKCE)
//   PUBLIC_URL        e.g. https://trip.example.com  (redirect URI becomes
//                     $PUBLIC_URL/auth/callback; derived from the request
//                     host when unset)
//   SESSION_SECRET    cookie signing secret (auto-generated + persisted if unset)
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import cookieSession from 'cookie-session';
import * as oidc from 'openid-client';
import { DATA_DIR } from './db.js';

let config = null; // openid-client discovery config

export function authEnabled() {
  return Boolean(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID);
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function redirectUri(req) {
  const base = process.env.PUBLIC_URL
    ? process.env.PUBLIC_URL.replace(/\/$/, '')
    : `${req.protocol}://${req.get('host')}`;
  return `${base}/auth/callback`;
}

export async function setupAuth(app) {
  if (!authEnabled()) {
    console.log('[auth] OIDC not configured — app is open. Protect it with your reverse proxy or a VPN.');
    app.get('/api/me', (req, res) => res.json({ auth: false, user: null }));
    return;
  }

  app.set('trust proxy', true);
  app.use(cookieSession({
    name: 'trip.sid',
    keys: [sessionSecret()],
    maxAge: 30 * 24 * 3600 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    // Secure cookies when served over https (via PUBLIC_URL); plain http
    // (LAN/VPN/testing) still works.
    secure: Boolean(process.env.PUBLIC_URL?.startsWith('https'))
  }));

  try {
    const issuer = new URL(process.env.OIDC_ISSUER_URL);
    config = await oidc.discovery(
      issuer,
      process.env.OIDC_CLIENT_ID,
      process.env.OIDC_CLIENT_SECRET || undefined,
      undefined,
      // allow http:// for LAN/VPN identity providers; use https in production
      issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : undefined
    );
    console.log('[auth] OIDC enabled via', process.env.OIDC_ISSUER_URL);
  } catch (err) {
    console.error('[auth] OIDC discovery failed:', err.message);
    console.error('[auth] refusing to start open — fix OIDC_* settings or unset them.');
    process.exit(1);
  }

  app.get('/auth/login', async (req, res) => {
    const code_verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    req.session.tx = { code_verifier, state, rd: safePath(req.query.rd) };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(req),
      scope: 'openid profile email',
      code_challenge: await oidc.calculatePKCECodeChallenge(code_verifier),
      code_challenge_method: 'S256',
      state
    });
    res.redirect(url.href);
  });

  app.get('/auth/callback', async (req, res) => {
    const tx = req.session?.tx;
    if (!tx) return res.redirect('/auth/login');
    try {
      const currentUrl = new URL(req.originalUrl, redirectUri(req));
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: tx.code_verifier,
        expectedState: tx.state
      });
      const claims = tokens.claims() || {};
      req.session.user = {
        sub: claims.sub,
        name: claims.name || claims.preferred_username || claims.email || 'traveller',
        email: claims.email || null
      };
      const rd = tx.rd || '/';
      delete req.session.tx;
      res.redirect(rd);
    } catch (err) {
      console.error('[auth] callback failed:', err.message);
      res.status(401).send('Login failed — <a href="/auth/login">try again</a>');
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session = null;
    const end = config.serverMetadata().end_session_endpoint;
    if (end) {
      const u = new URL(end);
      if (process.env.PUBLIC_URL) u.searchParams.set('post_logout_redirect_uri', process.env.PUBLIC_URL);
      return res.redirect(u.href);
    }
    res.redirect('/');
  });

  app.get('/api/me', (req, res) => res.json({ auth: true, user: req.session?.user || null }));

  // Everything else requires a session.
  app.use((req, res, next) => {
    if (req.session?.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not logged in' });
    res.redirect('/auth/login?rd=' + encodeURIComponent(safePath(req.originalUrl)));
  });
}

// only allow same-site relative redirect targets
function safePath(p) {
  p = String(p || '/');
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}
