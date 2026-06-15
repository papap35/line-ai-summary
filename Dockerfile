FROM node:20-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/app.js"]
