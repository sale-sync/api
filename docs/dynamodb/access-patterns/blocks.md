# Data Model
Sale Sync uses **DynamoDB with a single-table design**.

### Access Patterns

##### Workspace

| Pattern         | Key Condition                          | Command |
| --------------- | -------------------------------------- | ------- |
| Get a workspace | `PK = WORKSPACE#<id>`, `SK = METADATA` | GetItem |

##### Block

| Pattern         | Key Condtion                                         | Command    |
| --------------- | ---------------------------------------------------- | ---------- |
| List all blocks | `PK = WORKSPACE#<id>#BLOCK`, `SK begins_with BLOCK#` | Query      |
| Get one block   | `PK = WORKSPACE#<id>#BLOCK`, `SK = BLOCK#<block_id>` | GetItem    |
| Create block    | `PK = WORKSPACE#<id>#BLOCK`, `SK = BLOCK#<block_id>` | PutItem    |
| Update block    | `PK = WORKSPACE#<id>#BLOCK`, `SK = BLOCK#<block_id>` | UpdateItem |
| Delete block    | `PK = WORKSPACE#<id>#BLOCK`, `SK = BLOCK#<block_id>` | DeleteItem |

### Data Types

##### Workspace

```ts
type Workspace = {
	uuid: string
	id: string
	name: string
	created_at: string // ISO timestamp
	updated_at: string // ISO timestamp
}
```

##### Block

```ts
type Block = {
	id: string
	title: string
	data: BlockData
	draft: BlockData
	meta_object: MetaObject
	created_at: string // ISO timestamp
	updated_at: string // ISO timestamp
}
```

### Table Structure

| pk                     | sk                 | Attributes                                  |
| ---------------------- | ------------------ | ------------------------------------------- |
| `WORKSPACE#<id>`       | `METADATA`         | ==data: Workspace==, created_at, updated_at |
| `WORKSPACE#<id>#BLOCK` | `BLOCK#<block_id>` | ==data: Block==, `created_at`, `updated_at` |

