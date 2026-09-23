# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run download
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/src /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
