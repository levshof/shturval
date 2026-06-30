import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifySession, SESSION_COOKIE, signSession, type SessionPayload } from '../lib/jwt';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    userEmail: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Auth plugin: provides `app.authenticate` preHandler that reads the session
 * cookie and populates req.userId / req.userEmail, or responds 401.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest('userId', '');
  app.decorateRequest('userEmail', '');

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) {
      await reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Требуется вход' });
      return;
    }
    try {
      const session = verifySession(token);
      req.userId = session.userId;
      req.userEmail = session.email;
    } catch {
      await reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Сессия истекла, войдите снова' });
    }
  });
});

/** Set the session cookie on a reply. */
export function setSessionCookie(reply: FastifyReply, payload: SessionPayload) {
  const token = signSession(payload);
  // SameSite=None cookies MUST be Secure, so force it on in that case.
  const secure = config.COOKIE_SECURE || config.COOKIE_SAMESITE === 'none';
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: config.COOKIE_SAMESITE,
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
