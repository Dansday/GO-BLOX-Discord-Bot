FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package.json ./

RUN sh -c 'unset NODE_OPTIONS; npm install'

COPY . .

EXPOSE 80

CMD ["node", "index.js"]
