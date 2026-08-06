FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_LOCAL_MODE=true
ARG VITE_SOLVER_API_URL=
ENV VITE_LOCAL_MODE=${VITE_LOCAL_MODE} VITE_SOLVER_API_URL=${VITE_SOLVER_API_URL}
RUN npm run typecheck \
 && npm run lint \
 && VITE_LOCAL_MODE=false npm test -- --reporter=dot \
 && npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
