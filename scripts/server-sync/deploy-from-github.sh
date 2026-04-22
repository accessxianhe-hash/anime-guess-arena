#!/usr/bin/env bash
set -euo pipefail

# Auto-sync latest GitHub main branch to ECS app path, then rebuild anime-web.
# Defaults match the current production setup.

BASE_DIR="${BASE_DIR:-/opt/anime-guess-arena}"
SRC_DIR="${SRC_DIR:-$BASE_DIR/deploy-src}"
APP_DIR="${APP_DIR:-$BASE_DIR/app}"
REPO_URL="${REPO_URL:-https://github.com/accessxianhe-hash/anime-guess-arena.git}"
BRANCH="${BRANCH:-main}"
APP_OWNER="${APP_OWNER:-}"
APP_GROUP="${APP_GROUP:-}"

STATE_FILE="${STATE_FILE:-$BASE_DIR/.last_deployed_sha}"
LOCK_FILE="${LOCK_FILE:-/tmp/anime-sync-deploy.lock}"

ANIME_HEALTH_URL="${ANIME_HEALTH_URL:-https://anime.accessxianhe.site/api/health}"
ANIME_SERVER_FILE_API_URL="${ANIME_SERVER_FILE_API_URL:-https://anime.accessxianhe.site/api/admin/yearly-import/jobs/from-server-file}"
CPA_HEALTH_URL="${CPA_HEALTH_URL:-https://cpa.accessxianhe.site/management.html}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy] another deploy is running, skip"
  exit 0
fi

log() {
  echo "[deploy] $(date '+%F %T') $*"
}

detect_owner() {
  if [ -n "$APP_OWNER" ] && id "$APP_OWNER" >/dev/null 2>&1; then
    :
  elif id admin >/dev/null 2>&1; then
    APP_OWNER="admin"
  elif id ubuntu >/dev/null 2>&1; then
    APP_OWNER="ubuntu"
  elif [ -d "$APP_DIR" ]; then
    APP_OWNER="$(stat -c '%U' "$APP_DIR" 2>/dev/null || true)"
  fi

  if [ -z "$APP_OWNER" ] || ! id "$APP_OWNER" >/dev/null 2>&1; then
    APP_OWNER="$(id -un)"
  fi

  if [ -z "$APP_GROUP" ] || ! getent group "$APP_GROUP" >/dev/null 2>&1; then
    APP_GROUP="$(id -gn "$APP_OWNER" 2>/dev/null || true)"
  fi

  if [ -z "$APP_GROUP" ] || ! getent group "$APP_GROUP" >/dev/null 2>&1; then
    APP_GROUP="$APP_OWNER"
  fi
}

ensure_fallback_dockerfile() {
  if [ -f "$SRC_DIR/Dockerfile" ]; then
    return 0
  fi

  cat > "$APP_DIR/Dockerfile" <<'DOCKERFILE'
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Build-only defaults to satisfy env checks during `next build`.
ENV NEXTAUTH_SECRET=docker-build-secret
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_TRUST_HOST=true
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/anime_guess?schema=public
ENV STORAGE_PROVIDER=local
ENV ADMIN_SEED_EMAIL=admin@example.com
ENV ADMIN_SEED_NAME=SiteAdmin
ENV ADMIN_SEED_PASSWORD=ChangeMe_123456

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
DOCKERFILE

  chown "$APP_OWNER:$APP_GROUP" "$APP_DIR/Dockerfile"
}

ensure_fallback_dockerignore() {
  if [ -f "$SRC_DIR/.dockerignore" ]; then
    return 0
  fi

  cat > "$APP_DIR/.dockerignore" <<'DOCKERIGNORE'
node_modules
.next
.git
.github
data
tmp
DOCKERIGNORE

  chown "$APP_OWNER:$APP_GROUP" "$APP_DIR/.dockerignore"
}

check_http_code() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' "$url" || true
}

wait_for_200() {
  local url="$1"
  local attempts="${2:-20}"
  local delay="${3:-3}"
  local code=""

  for _ in $(seq 1 "$attempts"); do
    code="$(check_http_code "$url")"
    if [ "$code" = "200" ]; then
      echo "$code"
      return 0
    fi
    sleep "$delay"
  done

  echo "$code"
  return 1
}

mkdir -p "$BASE_DIR"
detect_owner
log "owner resolved: $APP_OWNER:$APP_GROUP"

if [ ! -d "$SRC_DIR/.git" ]; then
  log "initial clone: $REPO_URL ($BRANCH)"
  rm -rf "$SRC_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$SRC_DIR"
fi

log "fetch latest from origin/$BRANCH"
git -C "$SRC_DIR" fetch origin "$BRANCH" --depth 1

target_sha="$(git -C "$SRC_DIR" rev-parse "origin/$BRANCH")"
current_sha=""
if [ -f "$STATE_FILE" ]; then
  current_sha="$(cat "$STATE_FILE" || true)"
fi

if [ "$target_sha" = "$current_sha" ]; then
  log "no new commit ($target_sha), skip rebuild"
  exit 0
fi

log "deploy commit $target_sha"
git -C "$SRC_DIR" checkout -q "$BRANCH"
git -C "$SRC_DIR" reset --hard -q "origin/$BRANCH"

mkdir -p "$APP_DIR"
rsync -az --chown="$APP_OWNER:$APP_GROUP" \
  --exclude '.git' \
  --exclude '.github' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'data' \
  --exclude 'tmp' \
  --exclude '.env' \
  --exclude '.env.*' \
  "$SRC_DIR/" "$APP_DIR/"

ensure_fallback_dockerfile
ensure_fallback_dockerignore

cd "$BASE_DIR"
log "docker compose up -d --build anime-web"
docker compose up -d --build anime-web

printf '%s' "$target_sha" > "$STATE_FILE"
chown "$APP_OWNER:$APP_GROUP" "$STATE_FILE"

anime_health="502"
if anime_health="$(wait_for_200 "$ANIME_HEALTH_URL" 20 3)"; then
  log "anime health ok: $anime_health"
else
  log "anime health not ready yet: $anime_health"
fi

anime_api="$(check_http_code "$ANIME_SERVER_FILE_API_URL")"
cpa_health="$(check_http_code "$CPA_HEALTH_URL")"

log "checks: anime_health=$anime_health anime_server_file_api=$anime_api cpa=$cpa_health"
log "done"
