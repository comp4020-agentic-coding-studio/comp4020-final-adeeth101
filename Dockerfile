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

# The app runs as the unprivileged node user, so a bug in it can't rewrite
# the image. But /data is mounted at run time, over whatever the image put
# there --- a Fly volume, or the tmpfs CI starts the container with --- and a
# fresh mount belongs to root. Chowning it at build time does nothing for
# that, and the app then can't open its database at all. So the container
# starts as root only long enough to hand /data to node, and su-exec replaces
# itself with the app rather than staying in between: node is the process
# that receives Fly's stop signal.
RUN apk add --no-cache su-exec && mkdir -p /data && chown -R node:node /data /app

CMD ["sh", "-c", "chown node:node /data && exec su-exec node node src/server.ts"]
