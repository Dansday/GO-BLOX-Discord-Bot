FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 80

CMD ["node", "--import", "./backend/otel.js", "index.js"]
