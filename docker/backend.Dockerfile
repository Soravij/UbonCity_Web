FROM node:20-bookworm-slim
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY shared /app/shared
COPY backend ./
RUN mkdir -p uploads
EXPOSE 5000
CMD ["node","server.js"]