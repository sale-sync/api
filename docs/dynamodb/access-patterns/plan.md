## Plan

### Overview

This document describes the DynamoDB design for subscription plans. Plans are relatively static records (e.g. "basic", "pro") that define pricing tiers available to organisations. The design supports listing all plans and looking up a specific plan by either its UUID or its slug.


### Table Structure - DynamoDB Item Layout

| Key  | Index        | Value Pattern         | Purpose                                                                                   |
| ---- | ------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| `PK` | `main table` | `PLAN`                | `Fixed partition key grouping all plan metadata records`                                  |
| `SK` | `main table` | `META#{plan_uuid}`    | `Uniquely identifies a plan; supports point lookup by UUID`                               |
| `PK` | `main table` | `PLAN#ID#${plan_id}`  | `Lookup plan by slug; mostly used to check a plan_id exists (plan_id is a unique string)` |
| `SK` | `main table` | `META`                | `Fixed sort key for plan slug lookup records`                                             |

> **The `plan_id` vs `plan_uuid`** — `plan_uuid` is the UUID string while `plan_id` is the human-readable slug (e.g. `"basic"`, `"pro"`).


### Access Patterns

| Pattern               | Key Condition                                                          | Command      | Index        |
| --------------------- | ---------------------------------------------------------------------- | ------------ | ------------ |
| `List all plans`      | `PK = PLAN`<br>`SK begins_with META#`                                  | `Query`      | `main table` |
| `Get plan by UUID`    | `PK = PLAN`<br>`SK = META#${plan_uuid}`                                | `GetCommand` | `main table` |
| `Get plan by plan_id` | `PK = PLAN#ID#${plan_id}`<br>`SK = META`                              | `GetCommand` | `main table` |


### Typescript Type

##### Plan

```ts
export type Plan = {
  uuid: string
  plan_id: string // slug e.g. "basic" | "pro" — must be unique
  name: string
  info: string
  included: string[]
}
```
