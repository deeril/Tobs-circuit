FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
