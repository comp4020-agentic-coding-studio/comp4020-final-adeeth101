# syntax = docker/dockerfile:1

# Client assets are compiled on the builder, never on the small running
# machine. Blockly, Strudel and Vite are build-time inputs bundled into
# dist/client; the server's only runtime package is Acorn, which it uses to
# re-parse submitted code. A separate production install keeps the image to
# exactly that.
FROM docker.io/library/node:24.21.0-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY client/ ./client/
COPY shared/ ./shared/
COPY vite.config.ts tsconfig.json ./
RUN pnpm build

FROM docker.io/library/node:24.21.0-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM docker.io/library/node:24.21.0-alpine AS runtime

WORKDIR /app

# README.md is copied because the app serves it at /readme/ at request time,
# and the spec compares what's served against the file.
COPY package.json tsconfig.json README.md ./
COPY src/ ./src/
COPY public/ ./public/
COPY shared/ ./shared/
COPY --from=build /app/dist/ ./dist/
COPY --from=deps /app/node_modules/ ./node_modules/

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
