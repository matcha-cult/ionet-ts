FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm -w run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/demos ./demos
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379
ENV HTTP_PORT=8080
ENV WS_PORT=9080

EXPOSE 8080 9080

CMD ["node", "demos/demo-cluster/dist/main.js"]
