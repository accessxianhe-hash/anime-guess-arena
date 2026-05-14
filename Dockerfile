FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y openssl \
  && rm -rf /var/lib/apt/lists/*

# Build-only defaults to satisfy env checks during `next build`.
ENV NEXTAUTH_SECRET=docker-build-secret
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_TRUST_HOST=true
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/anime_guess?schema=public
ENV STORAGE_PROVIDER=local
ENV ADMIN_SEED_EMAIL=admin@example.com
ENV ADMIN_SEED_NAME=SiteAdmin
ENV ADMIN_SEED_PASSWORD=ChangeMe_123456

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
