# Etapa 1: Build (compila TypeScript)
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Etapa 2: Runtime (imagen liviana solo con dependencias de producción)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/proto ./dist/proto

EXPOSE 3001

CMD ["node", "dist/index.js"]