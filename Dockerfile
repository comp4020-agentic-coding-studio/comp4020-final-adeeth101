# syntax = docker/dockerfile:1

# The app has no runtime dependencies --- storage is node's own SQLite and the
# server is node:http --- so there is nothing to install and no build step:
# node 24 runs the TypeScript directly. That keeps the image small and the
# deploy fast, which matters on one 256 MB machine.
FROM docker.io/library/node:24.21.0-alpine

WORKDIR /app

# README.md is copied because the app serves it at /readme/ at request time,
# and the spec compares what's served against the file.
COPY package.json tsconfig.json README.md ./
COPY src/ ./src/
COPY public/ ./public/

ENV NODE_ENV=production
# fly.toml sets PORT; this is the fallback for a plain `docker run`.
ENV PORT=8080
EXPOSE 8080

# Not root, so a bug in the app can't rewrite the image. The volume at /data
# has to be writable by this user, hence the chown.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

CMD ["node", "src/server.ts"]
