# Stage 1 builds the protected browser code; stage 2 is the image that runs. The readable browser source never reaches the running image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY build.js ./
COPY public ./public
COPY private ./private
RUN node build.js
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY *.js ./
RUN rm -f build.js
COPY routes ./routes
COPY assets ./assets
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 COOKIE_SECURE=1
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
