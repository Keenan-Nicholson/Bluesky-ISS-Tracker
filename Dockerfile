FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM node:18-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY ISSBot.js .
RUN mkdir -p /app/data
CMD ["node", "ISSBot.js", "start-bot"]
