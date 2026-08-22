FROM node:22.13-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.4-alpine3.24
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html
VOLUME ["/tmp", "/var/cache/nginx", "/var/run"]
EXPOSE 8080
USER 101
