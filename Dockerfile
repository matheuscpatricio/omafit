# redeploy-trigger: 2026-06-03 (Python + trimesh para run_recipe glasses_canonical no Node)
# Estágio 1: build (precisa de devDependencies: vite, react-router, etc.)
# Espelho oficial em ECR Public — evita auth.docker.io (IPv6 / rede inacessível em alguns CI).
# @see https://gallery.ecr.aws/docker/library/node
FROM public.ecr.aws/docker/library/node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./

# Instala TODAS as dependências (incluindo dev) para o build
RUN npm ci

COPY . .

RUN npm run build

# Estágio 2: produção (só o necessário para rodar)
FROM public.ecr.aws/docker/library/node:20-alpine
RUN apk add --no-cache openssl python3 py3-pip py3-numpy \
  && pip3 install --no-cache-dir --break-system-packages "trimesh>=4.0.0"

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
# run_recipe.py (pós-processo óculos Rodin no Node — paridade worker trimesh)
COPY --from=builder /app/workers/ar-mesh-generate/postprocess ./workers/ar-mesh-generate/postprocess

CMD ["npm", "run", "docker-start"]
