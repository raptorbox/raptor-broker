FROM node:slim

RUN mkdir /app
WORKDIR /app

COPY ./ /app
RUN npm i --only=prod

ENTRYPOINT ["node", "index.js"]
