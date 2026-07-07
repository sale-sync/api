## Organisation

### Overview

This document describes the single-table DynamoDB design for a multi-tenant SaaS application. The model uses a single table with an inverted index (GSI) to support organisation-level and user-level access patterns efficiently.


### Table Structure - DynamoDB Item Layout

| Key  | Index                                | Value Pattern                | Purpose                                                                                      |
| ---- | ------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `PK` | `main table`                         | `ORG`                        | `Fixed partition key grouping all organisation metadata records`                             |
| `SK` | `main table`                         | `META#{org_uuid}`            | `Uniquely identifies an organisation; supports point lookups by ID`                          |
| `PK` | `main table`<br>`inverted-index`<br> | `ORG#{org_uuid}`             | `Groups all members of an organisation; used to list users in an organisation`               |
| `SK` | `main table`<br>`inverted-index`<br> | `USER#{user_id}`             | `Identifies a specific user within the organisation; supports direct member lookup`          |
| `PK` | `main table`                         | `ORG#ID#${org_id}`           | `Lookup organisation by id. Mostly checking org_id already exist since org_id unique string` |
| `SK` | `main table`                         | `META`                       | `Fixed sort key for organisation ID lookup records`                                          |
| `PK` | `main table`<br>`inverted-index`     | `USER#{user_email}`          | `Lookup the user by email`                                                                   |
| `SK` | `main table`<br>`inverted-index`     | `USER#{user_id}` \|\| `META` | `Lookup the user with user_id with inverted index`                                           |

> **The `org_id` vs `org_uuid`**  - The `org_uuid` is the uuid string while the `org_id` is organisation slug ( eg: `potato-rocket`, 'shape-fitness`)



> **The `inverted-index` GSI**  - Projects `SK` as the partition key and `PK` as the sort key, enabling reverse lookups:  list all organisations a user belongs to and  lookup user email by user_id.



### Access Patterns

| Pattern                                                      | Key Condition                                                                                                                                                                                                                                                                  | Command         | Index            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------- |
| `Organisation Metadata`<br><br>                              | `Fetch a single organisation's metadata by org_id`<br><br>`PK = ORG`<br>`SK = META#${org_uuid}`                                                                                                                                                                                | `GetCommand`    | `main table`     |
| `List all users in an organisation`                          | <br>`Query PK = "ORG#org_abc123" on the main table, SK begins with USER#`                                                                                                                                                                                                      | `Query`         | `main table`     |
| `List all organisations a user belongs to`                   | `Query SK = "USER#usr_xyz789" on the inverted-index`                                                                                                                                                                                                                           | `Query`         | `inverted-index` |
| `Update / Add Image`<br><br>`Reserved for standalone Lambda` | `1. S3 event triggers a standalone Lambda`<br>`2. image_id, org_id, name & url is extracted from the S3 object metadata, size and mime_type from the event.`<br>`3. Using UpdateCommand update the image attribute using Image Object with PK = "ORG", SK = "META#{org_uuid}"` | `UpdateCommand` | `main table`     |
| `Lookup organisation by id`                                  | `PK = ORG#ID#${org_id}`<br>`SK = META`                                                                                                                                                                                                                                         | `GetCommand`    | `main table`     |
| `Lookup user by email`                                       | `PK = USER#${user_email}`<br>`SK = META`                                                                                                                                                                                                                                       | `GetCommand`    | `main table`     |
| `Lookup user by user_id`                                     | `SK = USER#${user_id} on the inverted-index`                                                                                                                                                                                                                                   | `Query`         | `inverted-index` |



### Typescript Type 

##### BusinessCategory

```ts
export type BusinessCategory = 'fitness' | 'real-estate' | 'service-business' | 'restaurant' | 'haircut-and-salon'
```


##### Image
```ts
export type Image = { 
	name: string 
	url: string 
	size: string 
	mime_type: string 
}
```


##### Organisation Status

```ts
export type OrganisationStatus = 'pending' | 'active'
```

##### Organisation
```ts
export type Organisation = { 
	uuid: string 
	id: string // e.g. "potato-rocket" — must be unique 
	name: string 
	status: OrganisationStatus
	image: Image | null 
	business_category: BusinessCategory 
	template_id: string // uuid 
	plan_id: string // uuid 
	created_at: string 
	description?: string 
}
```


##### Organisation Role

```ts
export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'editor' | 'staff'
```

##### Organisation User

```ts
export type OrganisationUser = { 
	role: OrganisationRole 
	position?: string // position within the organisation 
	joined_date: string 
}
```

##### User

```ts
export type User = {
	status: 'unverified' | 'verified'
	profile: string // url to profile image
}
```

##### Pending User

```ts
export type PendingUser =  {
	status: 'pending'
}
```