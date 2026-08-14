FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=3000
ENV NODE_ENV=production
ENV VK_APP_ID=54720415

EXPOSE 3000

CMD ["node", "server/server.js"]
