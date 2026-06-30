import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface SessionPayload {
  userId: string;
  email: string;
}

export function signSession(payload: SessionPayload): string {
  // jsonwebtoken's types for expiresIn are strict; the value is validated config.
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifySession(token: string): SessionPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  if (typeof decoded === 'string') throw new Error('Invalid session token');
  const { userId, email } = decoded as jwt.JwtPayload & Partial<SessionPayload>;
  if (!userId || !email) throw new Error('Malformed session token');
  return { userId, email };
}

export const SESSION_COOKIE = 'wbsh_session';
