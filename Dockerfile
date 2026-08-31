# Self-hosting the HTTP transport, for claude.ai or any always-on machine.
#
# Multi-stage so the shipped image carries no TypeScript compiler and no dev
# dependencies. The build stage needs them; the runtime stage does not, and a
# smaller image is a smaller attack surface.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY README.md SKILL.md LICENSE ./

# Never root. This process makes outbound HTTP requests to hosts it does not
# control, so it runs with as little as possible.
USER node

EXPOSE 8000

# 0.0.0.0 inside the container is the only way the port is reachable from
# outside it. The server itself then refuses to start without
# PODCASTINDEX_HTTP_TOKEN, which is the check that matters.
ENV PODCASTINDEX_HTTP_HOST=0.0.0.0
ENV PODCASTINDEX_HTTP_PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js", "--http"]
