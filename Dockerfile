FROM node:18-alpine

# Cache bust v6 - fix winning excluding deposits
ARG CACHEBUST=6

# Build frontend
WORKDIR /frontend
COPY package.json ./
RUN npm install
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.ts postcss.config.js components.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# Setup backend
WORKDIR /app
COPY backend/package.json ./
RUN npm install --production
COPY backend/src ./src

# Copy frontend build to backend
RUN cp -r /frontend/dist ./public

EXPOSE 8000

CMD ["node", "src/index.js"]
