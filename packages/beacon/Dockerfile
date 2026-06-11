# Beacon — Phase 2 release orchestrator.
#
# Build from the MONOREPO ROOT (beacon depends on the @auto-factory/shared
# workspace):
#   docker build -f packages/beacon/Dockerfile -t auto-factory-beacon .
#   docker run -p 8080:8080 --env-file beacon.env auto-factory-beacon
#
# Runtime env (see packages/beacon/README.md):
#   BEACON_WEBHOOK_SECRET, GITHUB_TOKEN, LD_API_KEY, LD_PROJECT_KEY (app project),
#   LD_BASE_URL?, LD_ENVIRONMENT_KEY?, BEACON_STATE_FILE?, BEACON_MONITOR*?
#
# State note: the deploy-state store writes BEACON_STATE_FILE (default
# ./beacon-state.json). Mount a volume there if you want previousSha tracking
# to survive container replacement.

FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/config ./config
EXPOSE 8080
CMD ["node", "packages/beacon/dist/server.js"]
