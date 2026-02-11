# Estágio 1: build (precisa de devDependencies: vite, react-router, etc.)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./

# Instala TODAS as dependências (incluindo dev) para o build
RUN npm ci

COPY . .

RUN npm run build

# Estágio 2: produção (só o necessário para rodar)
FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Só dependências de produção para rodar o servidor
RUN npm ci --omit=dev && npm cache clean --force

# Copia o resultado do build do estágio anterior
COPY --from=builder /app/build ./build
# Prisma precisa do schema para o runtime (migrate deploy / generate)
COPY --from=builder /app/prisma ./prisma

CMD ["npm", "run", "docker-start"]
