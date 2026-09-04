FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_DEMO_MODE
ARG VITE_REPO_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
ENV VITE_REPO_URL=$VITE_REPO_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
CMD ["serve", "-s", "dist", "-l", "5173"]
