# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install all dependencies (including dev) so TypeScript can compile
COPY package.json package-lock.json ./
RUN npm ci

# Compile
COPY tsconfig.json ./
COPY src ./src
COPY mcp-server ./mcp-server
RUN npm run build

# Drop dev dependencies so only runtime deps are carried forward
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SIYUAN_BASE_URL=http://127.0.0.1:6806

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Run unprivileged. node:alpine ships a "node" user (uid 1000).
USER node

EXPOSE 3000

# The MCP endpoint returns 406 without the streamable-HTTP Accept header, which is
# still proof the server is listening and routing. Checking for a connection at all
# is what matters here; a 000 means the process is not serving.
# Uses 127.0.0.1 rather than "localhost" deliberately: in Alpine, "localhost" can
# resolve to ::1 first, which fails when the server is bound to IPv4.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').request({host:'127.0.0.1',port:process.env.PORT||3000,path:'/mcp',method:'POST',timeout:4000},r=>process.exit(r.statusCode?0:1)).on('error',()=>process.exit(1)).end()"

# Token is supplied at runtime via SIYUAN_TOKEN so it stays out of process args.
CMD ["node", "dist/mcp-server/bin/http.js"]
