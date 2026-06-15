FROM node:20-slim

# better-sqlite3 needs a toolchain to build its native binding if no prebuilt
# binary is available for the target platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DB_PATH=/data/messages.db

VOLUME ["/data"]

EXPOSE 5000

CMD ["node", "src/app.js"]
