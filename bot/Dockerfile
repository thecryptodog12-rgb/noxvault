FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
# The notification bot only; the keeper has its own Dockerfile.keeper (it needs ../sdk and ../web/lib).
RUN pnpm exec tsc -p tsconfig.json && pnpm prune --prod

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Mount a Railway volume at /data and set STATE_PATH=/data/state.json
CMD ["node", "dist/index.js"]
