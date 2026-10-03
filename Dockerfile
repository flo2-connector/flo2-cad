# The Agent CAD engine as an MCP server on stdio, for flo2's tool-server slot
# (no network, read-only root, unprivileged) or any laptop with Docker.
#   docker build -t flo2-cad .
#   docker run --rm -i --network none --read-only flo2-cad
# It writes nothing to disk: every file it makes comes back inside the MCP reply.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
USER node
ENTRYPOINT ["node", "/app/dist/src/main.js"]
