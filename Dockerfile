# Consus server + web UI. Builds from this repo alone:
#   docker build -t consus .
#   docker run --rm -p 8722:8722 -v consus-data:/data consus
# Env vars, ports and volumes are documented in README.md ("Run with Docker").

# ---- build: compile web (vite -> dist-web) and server (tsc -> dist-server) ----
FROM node:22-bookworm-slim AS build
# better-sqlite3 13 ships no prebuilt binaries: npm ci compiles it with
# node-gyp, so the build stage needs python3, make and g++. The runtime stage
# uses the same base image, so the compiled addon matches its glibc and Node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run build \
 && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8722 \
    HOST=0.0.0.0 \
    CONSUS_DB_PATH=/data/consus.sqlite \
    CONSUS_ATTACHMENTS_DIR=/data/attachments \
    CONSUS_PROJECTS_CONFIG=/data/consus-projects.json
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-web ./dist-web
COPY bin ./bin
# With no projects config, Consus registers one project, "consus", at the
# working directory and scans its .pHive/planning and .pHive/epics. Ship those
# so a fresh container has something to show.
COPY .pHive/planning ./.pHive/planning
COPY .pHive/epics ./.pHive/epics
RUN mkdir -p /data/attachments && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8722
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8722)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
