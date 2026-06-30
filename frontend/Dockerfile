# WB Shturval frontend — build static assets, serve with nginx (proxies /api).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Same-origin in the container: leave VITE_API_URL empty so the app calls /api,
# which nginx proxies to the backend (see nginx.conf).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
