FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY server.js db.js lib.js aicore.js chatkb.js ./
COPY routes ./routes
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 COOKIE_SECURE=1
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
