# Domains & Environments

Three environments, each with its own API domain and resource set:

| Environment | API domain | Resources | How to run |
|---|---|---|---|
| Local | `api.salesync.local` (conceptual — actually `http://localhost:8080`) | Staging by default | `make start` / `make dev` |
| Local (prod override) | same as above | **Production** | `make start.prod` / `make dev.prod` |
| Staging | `staging-api.salesync.biz` | Staging (`ResourcePrefix: staging-`) | deployed via a separate `staging` stack (not yet stood up — see [`docs/infra/README.md`](./README.md)) |
| Production | `api.salesync.biz` | Production (`ResourcePrefix: ''`) | deployed via `make deploy` |

## Local: staging by default, production only on demand

`make start` runs `sam local start-api --env-vars env.staging.json` — the local API server talks to real **staging** DynamoDB tables/S3 buckets (`staging-sale-sync-*`), never production, by default. `make dev` is the same thing under nodemon (auto-rebuilds and restarts `make start` on file change).

For the rare case where you need to verify against real production data, use `make start.prod` (or `make dev.prod` for the hot-reload version) instead — it swaps in `env.prod.json`, pointing the same local server at the real `sale-sync-*` (unprefixed) production resources. Use this sparingly and deliberately: it reads and writes real production data, there's no separate "prod-readonly" mode.

All four targets run the exact same code (`make build`) on the exact same port (`8080`) — only the `--env-vars` file changes which resources it talks to. See [`docs/infra/README.md`](./README.md#the-resourceprefix-parameter) for how `ResourcePrefix`/`env.*.json` drive this same staging-vs-production split for actual deployed stacks.

## Cloud domains — not yet provisioned

`api.salesync.biz` and `staging-api.salesync.biz` are the intended domain names, referenced in `openapi/spec.ts`'s `servers` list, but **no custom domain is actually wired up in CloudFormation today** — there's no `AWS::ApiGateway::DomainName`, ACM certificate, or Route53 record anywhere in `template.yaml`. Right now the API is only reachable via the raw API Gateway URL (`https://{api-id}.execute-api.{region}.amazonaws.com/Prod/`).

Provisioning the real custom domains (ACM cert + `AWS::ApiGateway::DomainName` + `AWS::ApiGateway::BasePathMapping` + Route53 alias record) is a separate follow-up, out of scope here — it needs a decision on hosted zone / existing certs and is a real production DNS/TLS change.

## Frontend app domains (for reference, not part of this API)

The frontend app has its own domains, referenced in every service's CORS allow-list (`app.ts`/`cors.ts`) and in `COGNITO_CALLBACK_URL`:

| Environment | Frontend domain |
|---|---|
| Local | `app.salesync.local` |
| Staging | `staging.salesync.biz` |
| Production | `app.salesync.biz` |

Note the naming convention differs from the API's: the frontend's staging domain is `staging.salesync.biz` (no `app.` prefix), while the API's staging domain is `staging-api.salesync.biz` (hyphenated prefix on `api`). Both are intentional/existing conventions for their respective subdomains — not a mismatch to fix, just worth knowing they don't mirror each other exactly.
