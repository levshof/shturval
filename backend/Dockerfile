# WB Shturval backend — runs via tsx (no separate build step, see DECISIONS D-0001).
FROM node:22-alpine

WORKDIR /app

# Install deps first (better layer caching). postinstall runs `prisma generate`.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# Apply pending migrations (idempotent) then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
