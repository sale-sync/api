.PHONY: help clean shared.pack bundle build start start.prod deploy.staging deploy.prod dev dev.prod deps deps.all deps.auth deps.organisation deps.media deps.blocks deps.templates deps.properties docs check.staging check.prod check.both

# Default target
.DEFAULT_GOAL := help

# === Shared package paths ===
SHARED_PKG_DIR   := packages
AUTH_VENDOR      := auth/vendor
ORG_VENDOR       := organisation/vendor
MEDIA_VENDOR     := media/vendor
BLOCKS_VENDOR    := blocks/vendor
TEMPLATE_VENDOR  := templates/vendor
PLAN_VENDOR      := plan/vendor
PROPERTIES_VENDOR := properties/vendor

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
	  -i 'auth/vendor' \
	  -i 'organisation/vendor' \
	  -i 'media/vendor' \
	  -i 'blocks/vendor' \
	  -i 'properties/vendor' \
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

# === Reinstall deps after shared.tgz update (so file:vendor/shared.tgz is picked up)

pkg: deps.auth deps.organisation deps.media deps.blocks
	@echo "==> Reinstalled @sale-sync/shared in all workspaces"

define REINSTALL_SHARED
	@echo "==> Reinstalling @sale-sync/shared in $(1)"
	@cd $(1) && \
	  npm uninstall @sale-sync/shared >/dev/null 2>&1 || true && \
	  rm -rf node_modules/@sale-sync/shared && \
	  npm install @sale-sync/shared@file:vendor/shared.tgz --prefer-offline --no-audit --no-fund --silent && \
	  echo "   ✓ $(1) done"
endef

deps.all: deps.auth deps.organisation deps.media deps.blocks deps.templates deps.plan deps.properties
	@echo "==> Reinstalled @sale-sync/shared in all workspaces"

deps.auth:
	$(call REINSTALL_SHARED,auth)

deps.organisation:
	$(call REINSTALL_SHARED,organisation)

deps.media:
	$(call REINSTALL_SHARED,media)

deps.blocks:
	$(call REINSTALL_SHARED,blocks)

deps.templates:
	$(call REINSTALL_SHARED,templates)

deps.plan:
	$(call REINSTALL_SHARED,plan)

deps.properties:
	$(call REINSTALL_SHARED,properties)

deps:
	@echo "==> Reinstalling all Lambda deps to pick up updated shared.tgz"
	npm install -w ./auth --prefer-offline --no-audit --no-fund
	npm install -w ./organisation --prefer-offline --no-audit --no-fund
	npm install -w ./media --prefer-offline --no-audit --no-fund
	npm install -w ./blocks --prefer-offline --no-audit --no-fund
	npm install -w ./templates --prefer-offline --no-audit --no-fund
	npm install -w ./plan --prefer-offline --no-audit --no-fund
	npm install -w ./properties --prefer-offline --no-audit --no-fund

# === Shared package tarball creation ===
shared.pack:
	@echo "==> Packing @sale-sync/shared from: $(abspath $(SHARED_PKG_DIR))"
	@test -f "$(SHARED_PKG_DIR)/package.json" || (echo "ERROR: package.json not found in $(abspath $(SHARED_PKG_DIR))"; exit 1)
	@cd "$(SHARED_PKG_DIR)" && npm run build
	@cd "$(SHARED_PKG_DIR)" && TARBALL=$$(npm pack --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].filename))"); \
		echo "==> Tarball: $$TARBALL"; \
		mkdir -p "../$(AUTH_VENDOR)" "../$(ORG_VENDOR)" "../$(MEDIA_VENDOR)" "../$(BLOCKS_VENDOR)" "../$(TEMPLATE_VENDOR)" "../$(PLAN_VENDOR)" "../$(PROPERTIES_VENDOR)"; \
		cp "$$TARBALL" "../$(AUTH_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(ORG_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(MEDIA_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(BLOCKS_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(TEMPLATE_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(PLAN_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(PROPERTIES_VENDOR)/shared.tgz"; \
		rm -f "$$TARBALL"
	@echo "==> Updated vendor tarballs: $(AUTH_VENDOR)/shared.tgz, $(ORG_VENDOR)/shared.tgz $(MEDIA_VENDOR)/shared.tgz $(BLOCKS_VENDOR)/shared.tgz $(TEMPLATE_VENDOR)/shared.tgz $(PLAN_VENDOR)/shared.tgz $(PROPERTIES_VENDOR)/shared.tgz"
	@$(MAKE) deps

# === Bundle each Lambda with esbuild ===
bundle: shared.pack
	@echo "==> Bundling auth Lambda"
	npm run -w ./auth bundle
	@echo "==> Bundling organisation Lambda"
	npm run -w ./organisation bundle
	@echo "==> Bundling media Lambda"
	npm run -w ./media bundle
	@echo "==> Bundling blocks Lambda"
	npm run -w ./blocks bundle
	@echo "==> Bundling templates Lambda"
	npm run -w ./templates bundle
	@echo "==> Bundling plan Lambda"
	npm run -w ./plan bundle
	@echo "==> Bundling properties Lambda"
	npm run -w ./properties bundle
	@echo "==> Bundling completed"

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
	rm -rf .aws-sam auth/bundle organisation/bundle media/bundle blocks/bundle templates/bundle plan/bundle properties/bundle

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
	@echo "  make shared.pack   - Build & pack shared module tarballs (and reinstall workspaces)"
	@echo "  make deps.all      - Reinstall @sale-sync/shared in all services from vendor tarballs"
	@echo "  make bundle        - Bundle API Lambdas with esbuild (auth, organisation, media, blocks)"
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