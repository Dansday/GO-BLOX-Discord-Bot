FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Asia/Singapore

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "main.js"]
