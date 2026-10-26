FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/image-size-compat packages/image-size-compat
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/web apps/web
COPY packages packages
RUN npm run build
FROM nginx:1.28.0-alpine
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
