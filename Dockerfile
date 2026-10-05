# The Agent CAD engine as an MCP server on stdio, for flo2's tool-server slot
# (no network, read-only root, unprivileged) or any laptop with Docker.
#   docker build -t flo2-cad .
#   docker run --rm -i --network none --read-only flo2-cad
# The engine is one bundled file (dist/main.js, committed and checked current in
# CI) plus the unmodified kernel (vendor/manifold-3d-3.5.4/). Nothing is
# installed at build time, nothing is fetched at run time, and nothing is
# written to disk: every file it makes comes back inside the MCP reply.

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY dist/ ./dist/
COPY vendor/ ./vendor/
# A relief's height image is a file the design keeps: flo2 mounts the design's folder here, read-only.
ENV FLO2_CAD_IMAGE_DIR=/design
USER node
ENTRYPOINT ["node", "/app/dist/main.js"]
