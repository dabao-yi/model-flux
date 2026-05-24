FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY admin/package.json ./admin/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY admin/package.json ./admin/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist
COPY proxy-models.example.json ./proxy-models.example.json
COPY docker-entrypoint.mjs ./docker-entrypoint.mjs

EXPOSE 19090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const fs=require('fs');let p='19090';try{const m=fs.readFileSync(process.env.CONFIG_ENV_PATH||'/app/.env','utf8').match(/^PROXY_PORT=(.*)$/m);if(m)p=m[1].trim().replace(/^\"|\"$/g,'').replace(/^'|'$/g,'')}catch{};fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "docker-entrypoint.mjs"]
