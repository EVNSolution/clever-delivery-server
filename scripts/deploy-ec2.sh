#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/clever-delivery-server}"
REPO_URL="${REPO_URL:-https://github.com/EVNSolution/clever-delivery-server.git}"
DEPLOY_REF="${DEPLOY_REF:-dev}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "Deploying ${REPO_URL}@${DEPLOY_REF} to ${APP_DIR}"

mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

if [ ! -d .git ]; then
  if [ -n "$(find . -mindepth 1 -maxdepth 1 ! -name .env ! -name Caddyfile -print -quit 2>/dev/null)" ]; then
    backup="${APP_DIR}/.pre-git.$(date -u +%Y%m%dT%H%M%SZ)"
    echo "Existing non-git app dir detected; moving deploy-managed files to ${backup}"
    mkdir -p "${backup}"
    find . -mindepth 1 -maxdepth 1 ! -name .env ! -name Caddyfile ! -name ".pre-git.*" -exec mv {} "${backup}/" \;
  fi
  git init
  git remote add origin "${REPO_URL}"
fi

git fetch --prune origin "${DEPLOY_REF}"
git checkout -B "${DEPLOY_REF}" "origin/${DEPLOY_REF}"
git reset --hard "origin/${DEPLOY_REF}"

if [ ! -f .env ]; then
  echo "Missing ${APP_DIR}/.env; refusing to deploy without runtime secrets." >&2
  exit 1
fi

if [ ! -f Caddyfile ]; then
  echo "Missing ${APP_DIR}/Caddyfile; copy Caddyfile.example and set the public hostname." >&2
  exit 1
fi

${COMPOSE} config >/tmp/clever-delivery-compose.yml
${COMPOSE} up -d --build
${COMPOSE} exec -T api npx prisma db push --skip-generate
${COMPOSE} exec -T api node -e "(async()=>{const r=await fetch('http://127.0.0.1:3000/healthz'); if(!r.ok) process.exit(1); console.log(await r.text());})().catch((error)=>{console.error(error); process.exit(1);})" >/tmp/clever-delivery-healthz.json
${COMPOSE} exec -T api node -e "(async()=>{const r=await fetch('http://127.0.0.1:3000/readyz'); if(!r.ok) process.exit(1); console.log(await r.text());})().catch((error)=>{console.error(error); process.exit(1);})" >/tmp/clever-delivery-readyz.json
${COMPOSE} ps
cat /tmp/clever-delivery-healthz.json
printf '\n'
cat /tmp/clever-delivery-readyz.json
printf '\nDeploy complete: %s@%s\n' "${REPO_URL}" "${DEPLOY_REF}"
