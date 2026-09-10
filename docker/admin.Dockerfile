FROM node:20-bookworm-slim AS build
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin ./
ARG VITE_API_URL
ARG VITE_FRONTEND_URL
ARG VITE_COLLECTOR_BASE_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
ENV VITE_COLLECTOR_BASE_URL=$VITE_COLLECTOR_BASE_URL
RUN npm run build
FROM nginx:alpine
COPY docker/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html
EXPOSE 80