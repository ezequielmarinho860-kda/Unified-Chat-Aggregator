const { randomUUID } = require('node:crypto');

const ADMIN_SESSION_COOKIE = 'uca_admin_session';

const createAdminAuth = ({
  adminSessionIdFactory = randomUUID,
  adminToken,
} = {}) => {
  const expectedToken = typeof adminToken === 'string' ? adminToken : '';
  const sessions = new Map();

  return {
    createSession(token) {
      if (token !== expectedToken) {
        const error = new Error('Admin token is invalid.');

        error.statusCode = 401;
        throw error;
      }

      const session = {
        createdAt: new Date().toISOString(),
        id: adminSessionIdFactory(),
        role: 'admin',
      };

      sessions.set(session.id, session);
      return session;
    },

    deleteSession(sessionId) {
      sessions.delete(sessionId);
    },

    getSession(sessionId) {
      return sessions.get(sessionId);
    },

    isConfigured() {
      return expectedToken.length > 0;
    },
  };
};

const requireAdminSession = (request, adminAuth) => {
  const session = adminAuth.getSession(getAdminSessionId(request));

  if (!session) {
    const error = new Error('Admin session is required.');

    error.statusCode = 401;
    throw error;
  }

  return session;
};

const getAdminSessionId = (request) =>
  parseCookieHeader(request.headers.cookie).get(ADMIN_SESSION_COOKIE) ?? '';

const parseCookieHeader = (cookieHeader = '') => {
  const cookies = new Map();

  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = entry.split('=');
    const name = rawName?.trim();

    if (!name) {
      continue;
    }

    cookies.set(name, rawValueParts.join('=').trim());
  }

  return cookies;
};

const createAdminSessionCookie = (sessionId) =>
  `${ADMIN_SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;

const createExpiredAdminSessionCookie = () =>
  `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

module.exports = {
  createAdminAuth,
  createAdminSessionCookie,
  createExpiredAdminSessionCookie,
  getAdminSessionId,
  requireAdminSession,
};
