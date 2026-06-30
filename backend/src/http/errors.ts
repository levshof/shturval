import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Application error with an HTTP status and a stable machine code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string) => new AppError(400, 'BAD_REQUEST', msg);
export const unauthorized = (msg = 'Требуется вход') => new AppError(401, 'UNAUTHENTICATED', msg);
export const notFound = (msg = 'Не найдено') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    // Zod validation error shape
    const anyErr = err as { name?: string; issues?: Array<{ path: (string | number)[]; message: string }>; message?: string; statusCode?: number };
    if (anyErr?.name === 'ZodError' && Array.isArray(anyErr.issues)) {
      const message = anyErr.issues
        .map((i) => `${i.path.join('.') || 'значение'}: ${i.message}`)
        .join('; ');
      return reply.code(400).send({ error: 'VALIDATION', message });
    }
    if (anyErr?.statusCode && anyErr.statusCode < 500) {
      return reply.code(anyErr.statusCode).send({ error: 'REQUEST', message: anyErr.message ?? 'Ошибка запроса' });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Внутренняя ошибка сервера' });
  });
}
