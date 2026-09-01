.PHONY: help clean bundle build start start.prod deploy.staging deploy.prod dev dev.prod docs test check.staging check.prod check.both admin.dev admin.dev.staging admin.dev.prod admin.bundle admin.build admin.start admin.start.staging admin.start.prod admin.deploy.staging admin.deploy.prod admin.clean admin.check.staging admin.check.prod admin.check.both admin.docs admin.test queries.dev queries.bundle queries.build queries.start queries.deploy.staging queries.deploy.prod queries.clean queries.check.staging queries.check.prod queries.check.both queries.test test.all

# Default target
.DEFAULT_GOAL := help

# === Dev mode ===
define NODEMON_WATCH
	npx nodemon -e ts,js,yml,yaml,json \
	  -w apps/api/auth \
	  -w apps/api/organisation \
	  -w apps/api/media \
	  -w apps/api/blocks \
	  -w apps/api/properties \
	  -w libs/shared/src \
	  -w template.yaml \
	  -i apps/api/auth/bundle \
	  -i apps/api/organisation/bundle \
	  -i apps/api/media/bundle \
	  -i apps/api/blocks/bundle \
	  -i apps/api/properties/bundle \
	  -i .aws-sam \
	  -i node_modules \
	  -i libs/shared/dist \
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
# `@sale-sync/shared` (libs/shared/) is a plain npm workspace dependency (services depend on
# `file:../../libs/shared`, which npm symlinks directly — no tarball, no vendor/ copies, no
# reinstall step). Nx's own task graph (nx.json's `bundle: { dependsOn: ["^build"] }`) builds
# `shared` first automatically, from cache when nothing changed. This replaced the old
# `make shared.pack` + `make deps.all` dance entirely (2026-07-19). Every service lives under
# `apps/`, the shared library under `libs/` (Nx's standard `apps`/`libs` workspace layout,
# adopted the same day).
bundle:
	@echo "==> Bundling all Lambdas via Nx (auto-builds packages/shared first, from cache if unchanged)"
	npm run bundle

# === Tests (integration + unit, via Jest per app, run through Nx) ===
test:
	@echo "==> Running client API tests"
	npm test

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
	rm -rf .aws-sam apps/api/auth/bundle apps/api/organisation/bundle apps/api/media/bundle apps/api/blocks/bundle apps/api/templates/bundle apps/api/payments/bundle apps/api/properties/bundle libs/shared/dist

# === OpenAPI docs server ===
docs:
	@echo "==> Starting OpenAPI docs server on :1778"
	cd apps/api/openapi && npx ts-node app.ts

# =============================================================================
# Admin API (staff-facing, admin-api.salesync.biz) — merged into this monorepo
# 2026-07-28. Own template (admin.template.yaml), samconfig (admin.samconfig.toml),
# and SAM build dir (.aws-sam-admin) so it never collides with the customer API's
# `make build`/`make deploy` above. Shares `libs/shared` (`@sale-sync/shared`) with
# the customer API — no separate admin-shared lib (2026-07-28) — same plain npm
# workspace dependency pattern, no shared.pack/vendor/reinstall dance.
# =============================================================================
define ADMIN_NODEMON_WATCH
	npx nodemon -e ts,js,yml,yaml,json \
	  -w apps/admin-api/payments \
	  -w apps/admin-api/organisation \
	  -w apps/admin-api/promo-codes \
	  -w apps/admin-api/auth \
	  -w libs/shared/src \
	  -w admin.template.yaml \
	  -i apps/admin-api/payments/bundle \
	  -i apps/admin-api/organisation/bundle \
	  -i apps/admin-api/promo-codes/bundle \
	  -i apps/admin-api/auth/bundle \
	  -i .aws-sam-admin \
	  -i node_modules \
	  -i libs/shared/dist \
	  --delay 700ms \
	  -x "$(1)"
endef

# Default admin dev mode. Talks to staging's Cognito pool/DynamoDB table,
# but COGNITO_CALLBACK_URL points at https://admin.salesync.local (nginx ->
# :3003, see /opt/homebrew/etc/nginx/servers/salesync-local.conf) instead of
# a deployed frontend domain — platform/apps/admin/ has no Amplify
# deployment at all, and browsers drop the OAuth/cookie flow if the
# redirect_uri doesn't match the domain actually being browsed (see
# admin.env.local.json). We never develop against raw localhost:3003 for
# this app for that reason.
admin.dev:
	@echo "==> Starting admin API development mode with nodemon (local: admin.salesync.local)"
	$(call ADMIN_NODEMON_WATCH,make admin.start)

# Same as admin.dev, but loads admin.env.staging.json as-is (callback URL
# points at the deployed staging-admin.salesync.biz frontend). Use when you
# specifically need to verify the config that's actually deployed to
# staging, not for routine local development.
admin.dev.staging:
	@echo "==> Starting admin API development mode with nodemon (staging config, staging-admin.salesync.biz callback)"
	$(call ADMIN_NODEMON_WATCH,make admin.start.staging)

# Continuous hot-reload dev mode against real production resources (prod Cognito
# pool/DynamoDB table), but — same as admin.dev — COGNITO_CALLBACK_URL points at
# admin.salesync.local rather than the real admin.salesync.biz, since that's what's
# actually being browsed locally (and, per 2026-08-08 testing, admin.salesync.biz
# turned out to already be serving something else unrelated/stale, so it's not a
# safe local-testing redirect target regardless). See admin.env.prod.local.json.
# Use sparingly, for one-off verification only — this reads/writes real prod data.
admin.dev.prod:
	@echo "==> Starting admin API development mode with nodemon (PRODUCTION resources, local callback — use sparingly)"
	$(call ADMIN_NODEMON_WATCH,make admin.start.prod)

admin.bundle:
	@echo "==> Bundling admin API Lambdas via Nx (auto-builds shared first, from cache if unchanged)"
	npm run admin.bundle

admin.test:
	@echo "==> Running admin API tests"
	npm run admin.test

admin.build: admin.bundle
	@echo "==> SAM build (admin API, zipping pre-bundled Lambdas)"
	sam build --template-file admin.template.yaml --build-dir .aws-sam-admin/build

admin.start: admin.build
	@echo "==> Starting local admin API (local: admin.salesync.local)"
	sam local start-api --template-file .aws-sam-admin/build/template.yaml --port 8081 --env-vars admin.env.local.json

admin.start.staging: admin.build
	@echo "==> Starting local admin API (staging config, staging-admin.salesync.biz callback)"
	sam local start-api --template-file .aws-sam-admin/build/template.yaml --port 8081 --env-vars admin.env.staging.json

# Points the local admin API at real production resources instead of staging,
# with the callback URL still pointed at admin.salesync.local (see admin.dev.prod
# above for why). Use sparingly, for one-off verification only — this reads/writes
# real prod data.
admin.start.prod: admin.build
	@echo "==> Starting local admin API (PRODUCTION resources, local callback — read/write against real data, use sparingly)"
	sam local start-api --template-file .aws-sam-admin/build/template.yaml --port 8081 --env-vars admin.env.prod.local.json

# Deploy to the staging stack (staging-sale-sync-admin-api). Syncs
# admin.env.staging.json into admin.samconfig.toml's [staging.deploy.parameters]
# section first so parameter_overrides can never go stale relative to
# admin.env.staging.json.
admin.deploy.staging: admin.bundle
	@echo "==> Syncing admin.env.staging.json into admin.samconfig.toml [staging.deploy.parameters]"
	npm run admin.samconfig:sync:staging
	@echo "==> SAM build (admin API, zipping pre-bundled Lambdas)"
	sam build --template-file admin.template.yaml --build-dir .aws-sam-admin/build
	@echo "==> Deploying admin API to AWS (staging)"
	sam deploy \
	  --template-file admin.template.yaml \
	  --config-file admin.samconfig.toml \
	  --config-env staging \
	  --resolve-s3

# Deploy to the production stack (sale-sync-admin-api). Syncs
# admin.env.prod.json into admin.samconfig.toml's [prod.deploy.parameters]
# section first so parameter_overrides can never go stale relative to
# admin.env.prod.json.
admin.deploy.prod: admin.bundle
	@echo "==> Syncing admin.env.prod.json into admin.samconfig.toml [prod.deploy.parameters]"
	npm run admin.samconfig:sync:prod
	@echo "==> SAM build (admin API, zipping pre-bundled Lambdas)"
	sam build --template-file admin.template.yaml --build-dir .aws-sam-admin/build
	@echo "==> Deploying admin API to AWS (production)"
	sam deploy \
	  --template-file admin.template.yaml \
	  --config-file admin.samconfig.toml \
	  --config-env prod \
	  --resolve-s3

admin.clean:
	@echo "==> Cleaning admin API build artifacts"
	rm -rf .aws-sam-admin apps/admin-api/payments/bundle apps/admin-api/organisation/bundle apps/admin-api/promo-codes/bundle apps/admin-api/auth/bundle

# === Resource audit (CloudFormation/DynamoDB/S3/Lambda, read-only) — admin stack ===
admin.check.staging:
	@./scripts/check-resources.sh admin staging

admin.check.prod:
	@./scripts/check-resources.sh admin prod

admin.check.both:
	@./scripts/check-resources.sh admin both

admin.docs:
	@echo "==> Starting Admin OpenAPI docs server on :1779"
	cd apps/admin-api/openapi && npx ts-node app.ts

# =============================================================================
# Queries API (public, unauthenticated, queries.salesync.biz) — merged into this
# monorepo from the standalone queries-api/ repo. Own template
# (queries.template.yaml), samconfig (queries.samconfig.toml), and SAM build dir
# (.aws-sam-queries) so it never collides with the customer or admin API's build
# dirs above. Shares `libs/shared` (`@sale-sync/shared`) with both — same plain
# npm workspace dependency pattern, no shared.pack/vendor/reinstall dance.
# =============================================================================
define QUERIES_NODEMON_WATCH
	npx nodemon -e ts,js,yml,yaml,json \
	  -w apps/queries-api/branding \
	  -w apps/queries-api/properties \
	  -w apps/queries-api/testimonials \
	  -w libs/shared/src \
	  -w queries.template.yaml \
	  -i apps/queries-api/branding/bundle \
	  -i apps/queries-api/properties/bundle \
	  -i apps/queries-api/testimonials/bundle \
	  -i .aws-sam-queries \
	  -i node_modules \
	  -i libs/shared/dist \
	  --delay 700ms \
	  -x "$(1)"
endef

queries.dev:
	@echo "==> Starting queries API development mode with nodemon (staging resources)"
	$(call QUERIES_NODEMON_WATCH,make queries.start)

queries.bundle:
	@echo "==> Bundling queries API Lambdas via Nx (auto-builds shared first, from cache if unchanged)"
	npm run queries.bundle

queries.test:
	@echo "==> Running queries API tests"
	npm run queries.test

queries.build: queries.bundle
	@echo "==> SAM build (queries API, zipping pre-bundled Lambdas)"
	sam build --template-file queries.template.yaml --build-dir .aws-sam-queries/build

queries.start: queries.build
	@echo "==> Starting local queries API (staging resources)"
	sam local start-api --template-file .aws-sam-queries/build/template.yaml --port 8082 --env-vars queries.env.staging.json

# Deploy to the staging stack (staging-sale-sync-queries-api). Syncs
# queries.env.staging.json into queries.samconfig.toml's [staging.deploy.parameters]
# section first so parameter_overrides can never go stale relative to
# queries.env.staging.json.
queries.deploy.staging: queries.bundle
	@echo "==> Syncing queries.env.staging.json into queries.samconfig.toml [staging.deploy.parameters]"
	npm run queries.samconfig:sync:staging
	@echo "==> SAM build (queries API, zipping pre-bundled Lambdas)"
	sam build --template-file queries.template.yaml --build-dir .aws-sam-queries/build
	@echo "==> Deploying queries API to AWS (staging)"
	sam deploy \
	  --template-file queries.template.yaml \
	  --config-file queries.samconfig.toml \
	  --config-env staging \
	  --resolve-s3

# Deploy to the production stack (sale-sync-queries-api). Syncs
# queries.env.prod.json into queries.samconfig.toml's [prod.deploy.parameters]
# section first so parameter_overrides can never go stale relative to
# queries.env.prod.json.
queries.deploy.prod: queries.bundle
	@echo "==> Syncing queries.env.prod.json into queries.samconfig.toml [prod.deploy.parameters]"
	npm run queries.samconfig:sync:prod
	@echo "==> SAM build (queries API, zipping pre-bundled Lambdas)"
	sam build --template-file queries.template.yaml --build-dir .aws-sam-queries/build
	@echo "==> Deploying queries API to AWS (production)"
	sam deploy \
	  --template-file queries.template.yaml \
	  --config-file queries.samconfig.toml \
	  --config-env prod \
	  --resolve-s3

queries.clean:
	@echo "==> Cleaning queries API build artifacts"
	rm -rf .aws-sam-queries apps/queries-api/branding/bundle apps/queries-api/properties/bundle apps/queries-api/testimonials/bundle

# === Resource audit (CloudFormation/DynamoDB/S3/Lambda, read-only) — queries stack ===
queries.check.staging:
	@./scripts/check-resources.sh queries staging

queries.check.prod:
	@./scripts/check-resources.sh queries prod

queries.check.both:
	@./scripts/check-resources.sh queries both

# === Run every test suite, all APIs ===
test.all: test admin.test queries.test

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
	@echo "  make test          - Run client API tests (integration + unit, all apps)"
	@echo "  make deploy.staging - Build + deploy to AWS (staging stack: staging-sale-sync-api)"
	@echo "  make deploy.prod   - Build + deploy to AWS (prod stack: sale-sync-api)"
	@echo "  make check.staging - List staging CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make check.prod    - List production CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make check.both    - Run check.staging + check.prod"
	@echo "  make clean         - Remove .aws-sam and bundle folders"
	@echo "  make docs          - Start OpenAPI documentation server on :1778"
	@echo ""
	@echo "Admin API (staff-facing, admin-api.salesync.biz):"
	@echo "  make admin.dev     - Run admin API dev mode with nodemon (local: admin.salesync.local — the default, we never dev against raw localhost:3003)"
	@echo "  make admin.bundle  - Bundle admin API Lambdas via Nx (auto-builds shared first)"
	@echo "  make admin.build   - Bundle + SAM build (admin.template.yaml, .aws-sam-admin)"
	@echo "  make admin.start   - Run local admin API after build (port 8081, local: admin.salesync.local)"
	@echo "  make admin.dev.staging   - Loads admin.env.staging.json as-is (staging-admin.salesync.biz callback — matches what's actually deployed to staging, NOT for local browser testing since that domain isn't deployed anywhere)"
	@echo "  make admin.start.staging - Same as admin.dev.staging, without nodemon"
	@echo "  make admin.dev.prod      - Local dev against PRODUCTION resources, callback still admin.salesync.local (use sparingly)"
	@echo "  make admin.start.prod    - Same as admin.dev.prod, without nodemon"
	@echo "  make admin.test    - Run admin API tests (integration + unit, all apps)"
	@echo "  make admin.deploy.staging - Build + deploy admin API to AWS (staging stack: staging-sale-sync-admin-api)"
	@echo "  make admin.deploy.prod    - Build + deploy admin API to AWS (prod stack: sale-sync-admin-api)"
	@echo "  make admin.clean   - Remove .aws-sam-admin and admin bundle folders"
	@echo "  make admin.check.staging - List staging admin API CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make admin.check.prod    - List production admin API CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make admin.check.both    - Run admin.check.staging + admin.check.prod"
	@echo "  make admin.docs    - Start Admin OpenAPI documentation server on :1779"
	@echo ""
	@echo "Queries API (public, unauthenticated, queries.salesync.biz):"
	@echo "  make queries.dev     - Run queries API dev mode with nodemon auto-rebuild"
	@echo "  make queries.bundle  - Bundle queries API Lambdas via Nx (auto-builds shared first)"
	@echo "  make queries.build   - Bundle + SAM build (queries.template.yaml, .aws-sam-queries)"
	@echo "  make queries.start   - Run local queries API after build (port 8082)"
	@echo "  make queries.test    - Run queries API tests (unit, all apps)"
	@echo "  make queries.deploy.staging - Build + deploy queries API to AWS (staging stack: staging-sale-sync-queries-api)"
	@echo "  make queries.deploy.prod    - Build + deploy queries API to AWS (prod stack: sale-sync-queries-api)"
	@echo "  make queries.clean   - Remove .aws-sam-queries and queries bundle folders"
	@echo "  make queries.check.staging - List staging queries API CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make queries.check.prod    - List production queries API CloudFormation/DynamoDB/S3/Lambda resources (read-only)"
	@echo "  make queries.check.both    - Run queries.check.staging + queries.check.prod"
	@echo ""
	@echo "Both:"
	@echo "  make test.all      - Run every test suite, client + admin + queries API"
	@echo ""