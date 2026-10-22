FROM node:22-alpine
WORKDIR /app
COPY package.json server.cjs ./
RUN npm install --omit=dev
COPY public ./public
COPY seed ./seed
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
