# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# sharp (icon generation) is a devDependency we do not need here; skip its native download.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
# Same-origin deployment: the API is proxied by nginx, so no VITE_API_URL.
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
