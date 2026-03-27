# Stage 1: Build Go binary
FROM golang:1.22 AS go-builder
WORKDIR /app
COPY config/atlas_go /app
RUN go build -o atlas .

# Stage 2: Build React UI
FROM node:20-alpine AS ui-builder
WORKDIR /ui
COPY data/react-ui/package*.json ./
RUN npm ci --silent
COPY data/react-ui/ ./
RUN npm run build

# Stage 3: Runtime
FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        nginx iputils-ping nmap sqlite3 net-tools curl ca-certificates nbtscan docker.io && \
    apt-get upgrade -y && \
    pip install --no-cache-dir fastapi==0.121.0 uvicorn==0.38.0 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Nginx config
RUN rm -f /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default || true
COPY config/nginx/default.conf.template /config/nginx/default.conf.template

# Static UI (built in stage 2)
COPY --from=ui-builder /ui/dist/ /usr/share/nginx/html/

# Scripts and Go binary
COPY config/scripts /config/scripts
COPY --from=go-builder /app/atlas /config/bin/atlas
RUN chmod +x /config/scripts/*.sh

# Default env
ENV ATLAS_UI_PORT=8888
ENV ATLAS_API_PORT=8889
ENV FASTSCAN_INTERVAL=3600
ENV DOCKERSCAN_INTERVAL=3600
ENV DEEPSCAN_INTERVAL=7200

EXPOSE 8888 8889
CMD ["/config/scripts/atlas_check.sh"]