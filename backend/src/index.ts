import { buildServer } from './server';
import { config } from './config';
import { prisma } from './db';

async function main() {
  const app = await buildServer();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`WB Shturval backend listening on :${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down…`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
