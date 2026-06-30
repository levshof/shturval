import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { hashPassword, verifyPassword } from '../lib/password';
import { setSessionCookie, clearSessionCookie } from '../http/auth';
import { conflict, unauthorized } from '../http/errors';

const RegisterSchema = z.object({
  email: z.string().email('Некорректный email').transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, 'Пароль не короче 8 символов'),
  companyName: z.string().trim().max(200).optional(),
});

const LoginSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
});

function publicUser(u: { id: string; email: string; companyName: string | null }) {
  return { id: u.id, email: u.email, companyName: u.companyName };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('Пользователь с таким email уже существует');
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        companyName: body.companyName ?? null,
        supplySettings: { create: {} }, // defaults from schema
      },
    });
    setSessionCookie(reply, { userId: user.id, email: user.email });
    return { user: publicUser(user) };
  });

  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Неверный email или пароль');
    }
    setSessionCookie(reply, { userId: user.id, email: user.email });
    return { user: publicUser(user) };
  });

  app.post('/logout', async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw unauthorized();
    return { user: publicUser(user) };
  });
};
