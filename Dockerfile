FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY railway.toml ./

RUN npm run build

CMD ["node", "dist/index.js"]
