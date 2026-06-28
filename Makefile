.PHONY: help clean shared.pack bundle bundle.s3-event build start deploy dev deps deps.all deps.auth deps.organisation deps.crm deps.media deps.blocks docs

# Default target
.DEFAULT_GOAL := help

# === Shared package paths ===
SHARED_PKG_DIR := packages
AUTH_VENDOR    := auth/vendor
ORG_VENDOR     := organisation/vendor
CRM_VENDOR     := crm/vendor
MEDIA_VENDOR   := media/vendor
BLOCKS_VENDOR  := blocks/vendor

# === Dev mode ===
dev:
	@echo "==> Starting development mode with nodemon"
	npx nodemon -e ts,js,yml,yaml,json \
	  -w auth \
	  -w organisation \
	  -w crm \
	  -w media \
	  -w blocks \
	  -w packages/src \
	  -w template.yaml \
	  -i auth/bundle \
	  -i organisation/bundle \
	  -i crm/bundle \
	  -i media/bundle \
	  -i blocks/bundle \
	  -i .aws-sam \
	  -i node_modules \
	  -i 'auth/vendor' \
	  -i 'organisation/vendor' \
	  -i 'crm/vendor' \
	  -i 'media/vendor' \
	  -i 'blocks/vendor' \
	  --delay 700ms \
	  -x "make start"

# === Reinstall deps after shared.tgz update (so file:vendor/shared.tgz is picked up)

pkg: deps.auth deps.organisation deps.crm deps.media deps.blocks
	@echo "==> Reinstalled @sales-sync/shared in all workspaces"

define REINSTALL_SHARED
	@echo "==> Reinstalling @sales-sync/shared in $(1)"
	@cd $(1) && \
	  npm uninstall @sales-sync/shared >/dev/null 2>&1 || true && \
	  rm -rf node_modules/@sales-sync/shared && \
	  npm install @sales-sync/shared@file:vendor/shared.tgz --prefer-offline --no-audit --no-fund --silent && \
	  echo "   ✓ $(1) done"
endef

deps.all: deps.auth deps.organisation deps.crm deps.media deps.blocks
	@echo "==> Reinstalled @sales-sync/shared in all workspaces"

deps.auth:
	$(call REINSTALL_SHARED,auth)

deps.organisation:
	$(call REINSTALL_SHARED,organisation)

deps.crm:
	$(call REINSTALL_SHARED,crm)

deps.media:
	$(call REINSTALL_SHARED,media)

deps.blocks:
	$(call REINSTALL_SHARED,blocks)

deps:
	@echo "==> Reinstalling all Lambda deps to pick up updated shared.tgz"
	npm install -w ./auth --prefer-offline --no-audit --no-fund
	npm install -w ./organisation --prefer-offline --no-audit --no-fund
	npm install -w ./crm --prefer-offline --no-audit --no-fund
	npm install -w ./media --prefer-offline --no-audit --no-fund
	npm install -w ./blocks --prefer-offline --no-audit --no-fund

# === Shared package tarball creation ===
shared.pack:
	@echo "==> Packing @sales-sync/shared from: $(abspath $(SHARED_PKG_DIR))"
	@test -f "$(SHARED_PKG_DIR)/package.json" || (echo "ERROR: package.json not found in $(abspath $(SHARED_PKG_DIR))"; exit 1)
	@cd "$(SHARED_PKG_DIR)" && npm run build
	@cd "$(SHARED_PKG_DIR)" && TARBALL=$$(npm pack --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0].filename))"); \
		echo "==> Tarball: $$TARBALL"; \
		mkdir -p "../$(AUTH_VENDOR)" "../$(ORG_VENDOR)" "../$(CRM_VENDOR)" "../$(MEDIA_VENDOR)" "../$(BLOCKS_VENDOR)"; \
		cp "$$TARBALL" "../$(AUTH_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(ORG_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(CRM_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(MEDIA_VENDOR)/shared.tgz"; \
		cp "$$TARBALL" "../$(BLOCKS_VENDOR)/shared.tgz"; \
		rm -f "$$TARBALL"
	@echo "==> Updated vendor tarballs: $(AUTH_VENDOR)/shared.tgz, $(CRM_VENDOR)/shared.tgz, $(ORG_VENDOR)/shared.tgz $(MEDIA_VENDOR)/shared.tgz $(BLOCKS_VENDOR)/shared.tgz"
	@$(MAKE) deps

# === Bundle each Lambda with esbuild ===
bundle: shared.pack
	@echo "==> Bundling auth Lambda"
	npm run -w ./auth bundle
	@echo "==> Bundling organisation Lambda"
	npm run -w ./organisation bundle
	@echo "==> Bundling crm Lambda"
	npm run -w ./crm bundle
	@echo "==> Bundling media Lambda"
	npm run -w ./media bundle
	@echo "==> Bundling blocks Lambda"
	npm run -w ./blocks bundle
	@echo "==> Bundling completed"

# === Bundle S3 event Lambda (only needed for deploy) ===
bundle.s3-event:
	@echo "==> Bundling media-s3-event Lambda"
	cd media-s3-event && npm install --prefer-offline --no-audit --no-fund && npm run bundle

# === SAM build & deploy commands ===
build: bundle
	@echo "==> SAM build (zipping pre-bundled Lambdas)"
	sam build

start: build
	@echo "==> Starting local API"
	sam local start-api --port 8080 --env-vars env.staging.json

# Deploy needs s3-event bundled before SAM build
deploy: bundle bundle.s3-event
	@echo "==> SAM build (zipping pre-bundled Lambdas)"
	sam build
	@echo "==> Deploying to AWS"
	sam deploy \
	  --stack-name sales-sync-api \
	  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
	  --resolve-s3 \

# === Cleanup ===
clean:
	@echo "==> Cleaning build artifacts"
	rm -rf .aws-sam auth/bundle organisation/bundle crm/bundle media/bundle media-s3-event/bundle blocks/bundle

# === OpenAPI docs server ===
docs:
	@echo "==> Starting OpenAPI docs server on :1778"
	cd openapi && npx ts-node app.ts

# === Help ===
help:
	@echo ""
	@echo "Sales Sync API Commands:"
	@echo "  make dev           - Run dev mode with nodemon auto-rebuild"
	@echo "  make shared.pack   - Build & pack shared module tarballs (and reinstall workspaces)"
	@echo "  make deps.all      - Reinstall @sales-sync/shared in all services from vendor tarballs"
	@echo "  make bundle        - Bundle API Lambdas with esbuild (auth, organisation, crm, media, blocks)"
	@echo "  make bundle.s3-event - Bundle S3 event Lambda (only needed for deploy)"
	@echo "  make build         - Bundle + SAM build (no rebuild inside SAM)"
	@echo "  make start         - Run local API after build"
	@echo "  make deploy        - Build + bundle S3 event + deploy to AWS"
	@echo "  make clean         - Remove .aws-sam and bundle folders"
	@echo "  make docs          - Start OpenAPI documentation server on :1778"
	@echo ""