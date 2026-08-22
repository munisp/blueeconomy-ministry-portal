FROM node:22.13-alpine@sha256:1322b1e3975e50d4841db1f23f536a8e72249e16a89e1dbbf16953afaa816d41 AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.4-alpine3.24@sha256:b18de2210c3255d942d7067f99429ec78a62ce957a14d6a11baa1b684f492dff
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html
VOLUME ["/tmp", "/var/cache/nginx", "/var/run"]
EXPOSE 8080
USER 101
