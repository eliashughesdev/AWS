FROM tatumio/tatum-kms:latest

WORKDIR /usr/src/app

COPY package*.json ./
USER root
RUN chown -R node:node /usr/src/app
USER node

RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["npm start"]
