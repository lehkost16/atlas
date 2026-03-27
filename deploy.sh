#!/bin/bash
set -euo pipefail

echo "🔧 Atlas CI/CD Deployment Script"

# Check docker access
if ! docker info >/dev/null 2>&1; then
  echo "❌ Cannot connect to Docker. Run: sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi
echo "✅ Docker access confirmed"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="${REPO_ROOT}/data/react-ui"
IMAGE="keinstien/atlas"
CONTAINER_NAME="atlas-dev"

echo "📁 Repo root: $REPO_ROOT"

# Version
if [[ -z "${VERSION:-}" ]]; then
  read -p "👉 Version tag (e.g. v4.0): " VERSION
fi
[[ -z "${VERSION:-}" ]] && { echo "❌ Version required."; exit 1; }

# Tag as latest?
if [[ -z "${TAG_LATEST:-}" ]]; then
  read -p "👉 Also tag as 'latest'? (y/N): " TAG_LATEST
fi
[[ "${TAG_LATEST:-}" =~ ^[yY] ]] && DO_LATEST=true || DO_LATEST=false

# Push to Docker Hub?
if [[ -z "${DO_PUSH:-}" ]]; then
  read -p "👉 Push to Docker Hub? (y/N): " DO_PUSH
fi
[[ "${DO_PUSH:-}" =~ ^[yY] ]] && PUSH=true || PUSH=false

[[ -d "$UI_DIR" ]] || { echo "❌ UI dir not found: $UI_DIR"; exit 1; }

# Write build-info.json into React public/ (picked up by ui-builder stage)
COMMIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'dirty')"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
mkdir -p "$UI_DIR/public"
cat > "$UI_DIR/public/build-info.json" <<EOF
{ "version": "${VERSION}", "commit": "${COMMIT_SHA}", "builtAt": "${BUILD_TIME}" }
EOF
echo "� build-info.json written (version: $VERSION, commit: $COMMIT_SHA)"

# Stop existing container
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# Build image (React + Go compiled inside Docker)
echo "🐳 Building $IMAGE:$VERSION ..."
docker build -t "$IMAGE:$VERSION" "$REPO_ROOT"

$DO_LATEST && docker tag "$IMAGE:$VERSION" "$IMAGE:latest" && echo "� Tagged as latest"

# Push
if $PUSH; then
  docker push "$IMAGE:$VERSION"
  $DO_LATEST && docker push "$IMAGE:latest"
  echo "📤 Pushed to Docker Hub"
fi

# Run
echo "� Starting container $CONTAINER_NAME ..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --network=host \
  --cap-add=NET_RAW \
  --cap-add=NET_ADMIN \
  -e ATLAS_UI_PORT=8884 \
  -e ATLAS_API_PORT=8885 \
  -e ATLAS_ADMIN_PASSWORD='change-me' \
  -e SCAN_SUBNETS='192.168.10.0/24,192.168.11.0/24' \
  -v /var/run/docker.sock:/var/run/docker.sock \
  "$IMAGE:$VERSION"

echo "✅ Done — version: $VERSION"
echo "   UI:  http://localhost:8884"
echo "   API: http://localhost:8885/api/docs"
