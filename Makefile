.PHONY: help clean bundle build start start.prod deploy.staging deploy.prod dev dev.prod docs check.staging check.prod check.both

# Default target
.DEFAULT_GOAL := help

# === Dev mode ===
define NODEMON_WATCH
	npx nodemon -e ts,js,yml,yaml,json \
	  -w auth \
	  -w organisation \
	  -w media \
	  -w blocks \
	  -w properties \
	  -w packages/src \
	  -w template.yaml \
	  -i auth/bundle \
	  -i organisation/bundle \
	  -i media/bundle \
	  -i blocks/bundle \
	  -i properties/bundle \
	  -i .aws-sam \
	  -i node_modules \
	  -i packages/dist \
	  --delay 700ms \
	  -x "$(1)"
endef

dev:
	@echo "==> Starting development mode with nodemon (staging resources)"
	$(call NODEMON_WATCH,make start)

# Continuous hot-reload dev mode against real production resources.
# Use sparingly, for one-off verification only — same caveats as `make start.prod`.
dev.prod:
	@echo "==> Starting development mode with nodemon (PRODUCTION resources — use sparingly)"
	$(call NODEMON_WATCH,make start.prod)

# === Bundle each Lambda with esbuild, via Nx ===
# `@sale-sync/shared` is a plain npm workspace dependency now (services depend on
# `file:../packages`, which npm symlinks straight to `packages/` — no tarball, no vendor/
# copies, no reinstall step). Nx's own task graph (nx.json's `bundle: { dependsOn: ["^build"] }`)
# builds `shared` first automatically, from cache when nothing changed. This replaced the old
# `make shared.pack` + `make deps.all` dance entirely (2026-07-19).
bundle:
	@echo "==> Bundling all Lambdas via Nx (auto-builds packages/shared first, from cache if unchanged)"
	npm run bundle

# === SAM build & deploy commands ===
build: bundle
	@echo "==> SAM build (zipping pre-bundled Lambdas)"
	sam build

start: build
	@echo "==> Starting local API (staging resources)"
	sam local start-api --port 8080 --env-vars env.staging.json

# Points the local API at real production resources instead of staging.
# Use sparingly, for one-off verification only — this reads/writes the actual
# prod DynamoDB tables and S3 buckets.
start.prod: build
	@echo "==> Starting local API (PRODUCTION resources — read/write against real data, use sparingly)"
	sam local start-api --port 8080 --env-vars env.prod.json

# Deploy to the staging stack (staging-sale-sync-api). Syncs env.staging.json
# into samconfig.toml's [staging.deploy.parameters] section first so
# parameter_overrides can never go stale relative to env.staging.json.
deploy.staging: bundle
	@echo "==> Syncing env.staging.json into samconfig.toml [staging.deploy.parameters]"
	npm run samconfig:sync:staging
	@echo "==> SAM build (zipping pre-bundled Lambdas)"
	sam build
	@echo "==> Deploying to AWS (staging)"
	sam deploy --config-env staging

# Deploy to the production stack (sale-sync-api). Syncs env.prod.json into
# samconfig.toml's [prod.deploy.parameters] section first so
# parameter_overrides can never go stale relative to env.prod.json.
deploy.prod: bundle
	@echo "==> Syncing env.prod.json into samconfig.toml [prod.deploy.parameters]"
	npm run samconfig:sync:prod
	@echo "==> SAM build (zipping pre-bundled Lambdas)"
	sam build
	@echo "==> Deploying to AWS (production)"
	sam deploy --config-env prod

# === Resource audit (CloudFormation/DynamoDB/S3/Lambda, read-only) ===
check.staging:
	@./scripts/check-resources.sh staging

check.prod:
	@./scripts/check-resources.sh prod

check.both:
	@./scripts/check-resources.sh both

# === Cleanup ===
clean:
	@echo "==> Cleaning build artifacts"
	rm -rf .aws-sam auth/bundle organisation/bundle media/bundle blocks/bundle templates/bundle plan/bundle properties/bundle packages/dist

# === OpenAPI docs server ===
docs:
	@echo "==> Starting OpenAPI docs server on :1778"
	cd openapi && npx ts-node app.ts

# === Help ===
help:
	@echo ""
	@echo "Sale Sync API Commands:"
	@echo "  make dev           - Run dev mode with nodemon auto-rebuild (staging resources)"
	@echo "  make dev.prod      - Run dev mode against PRODUCTION resources (use sparingly)"
	@echo "  make bundle        - Bundle API Lambdas via Nx (auto-builds packages/shared first)"
	@echo "  make build         - Bundle + SAM build (no rebuild inside SAM)"
	@echo "  make start         - Run local API after build (staging resources)"
	@echo "  make start.prod    - Run local API against PRODUCTION resources (use sparingly)"
	@echo "  make deploy.staging - Build + deploy to AWS (staging stack: staging-sale-sync-api)"
	@echo "  make deploy.prod   - Build + deploy to AWS (prod stack: sale-sync-api)"
	@echo "  make check.staging - List staging CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make check.prod    - List production CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make check.both    - Run check.staging + check.prod"
	@echo "  make clean         - Remove .aws-sam and bundle folders"
	@echo "  make docs          - Start OpenAPI documentation server on :1778"
	@echo ""