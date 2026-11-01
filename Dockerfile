# Runs the GEDT server. Build:  docker build -t gedt .
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY database ./database
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node server/scripts/load-db.js --if-empty && node server/src/server.js"]
