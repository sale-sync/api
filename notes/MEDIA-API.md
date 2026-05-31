# Media API

Media library management for the Sale Sync platform with workspace-scoped storage and nested folder support.

**Base Path:** `/media`  
**Authentication:** Required (Cookie-based JWT)  
**Tenant Isolation:** Workspace-scoped (all media belongs to a workspace)

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Concepts](#concepts)
  - [Workspace Isolation](#workspace-isolation)
  - [Folder Hierarchy](#folder-hierarchy)
  - [Root Folder](#root-folder)
- [Endpoints](#endpoints)
  - [List Contents](#list-contents)
  - [Get Upload URL](#get-upload-url)
  - [Create Folder](#create-folder)
  - [Get Media Details](#get-media-details)
  - [Get Download URL](#get-download-url)
  - [Move Item](#move-item)
  - [Rename Item](#rename-item)
  - [Delete Item](#delete-item)
- [Data Models](#data-models)
- [DynamoDB Schema](#dynamodb-schema)
- [Error Responses](#error-responses)
- [Examples](#examples)
- [Project Structure](#project-structure)

---

## Overview

The Media API provides a complete file management system for Sale Sync workspaces. Each workspace has an isolated media library with support for nested folders up to 7 levels deep.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Media API Flow                                                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Workspace: acme-corp                                           │   │
│  │                                                                 │   │
│  │  📁 ROOT (auto-created)                                         │   │
│  │  ├── 📁 Marketing                                               │   │
│  │  │   ├── 📁 Campaigns                                           │   │
│  │  │   │   ├── 📁 Q1-2024                                         │   │
│  │  │   │   │   ├── 🖼️ banner.png                                  │   │
│  │  │   │   │   └── 🖼️ logo.svg                                    │   │
│  │  │   │   └── 📁 Q2-2024                                         │   │
│  │  │   └── 📄 brand-guide.pdf                                     │   │
│  │  ├── 📁 Products                                                │   │
│  │  └── 🖼️ hero-image.jpg  (in root)                               │   │
│  │                                                                 │   │
│  │  Max nesting: 7 levels (ROOT → L1 → L2 → L3 → L4 → L5 → L6)     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Upload Flow:                                                           │
│  1. POST /media/upload → Get presigned S3 URL                           │
│  2. PUT to S3 URL → Upload file directly                                │
│  3. Media record created in DynamoDB                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication

All endpoints require authentication via cookies:

| Cookie | Description |
|--------|-------------|
| `Authentication` | Auth token (presence check) |
| `Identifier` | JWT containing user claims |
| `Workspace` | JWT containing workspace claims |

**User claims extracted from `Identifier` JWT:**

```typescript
interface IUser {
    id: string;             // JWT `sub` claim
    name: string;           // JWT `name` claim
    email: string;          // JWT `email` claim
    email_verified: boolean;
}
```

**Workspace claims extracted from `Workspace` JWT:**

```typescript
interface IWorkspace {
    workspace_id: string;   // Workspace slug identifier
    user_id: string;        // User's ID within workspace context
    uuid: string;           // Workspace UUID (used for data isolation)
}
```

**Authentication Flow in Controllers:**

```typescript
import { isAuthorize, getUser, UNAUTHORIZE_ERROR, NO_USER } from '@devyethiha/samjs';
import { getWorkspace, NO_WORKSPACE } from '@sales-sync/shared';

// Step 1: Check auth token
if (!isAuthorize(event)) return UNAUTHORIZE_ERROR;  // 401

// Step 2: Extract user from Identifier JWT
const user = getUser(event);
if (!user) return NO_USER;  // 404

// Step 3: Extract workspace from Workspace JWT
const workspace = getWorkspace(event);
if (!workspace) return NO_WORKSPACE;  // 404

// Use workspace.uuid for all data operations
const workspace_id = workspace.uuid;
```

**Note:** The `Workspace` cookie is set when the user selects/enters a workspace in the frontend. All media operations are scoped to the workspace in this cookie — no need to pass `workspace_id` in requests.

---

## Concepts

### Workspace Isolation

Every workspace has its own isolated media library. Media from one workspace cannot be accessed by users of another workspace.

```
Workspace A                    Workspace B
┌──────────────┐              ┌──────────────┐
│ 📁 ROOT      │              │ 📁 ROOT      │
│ ├── 📁 Docs  │              │ ├── 📁 Sales │
│ └── 🖼️ img   │              │ └── 📄 doc   │
└──────────────┘              └──────────────┘
     ✗ No cross-access ✗
```

### Folder Hierarchy

Folders can be nested up to **7 levels deep** (including root):

| Level | Example Path |
|-------|--------------|
| 0 (Root) | `/` |
| 1 | `/Marketing` |
| 2 | `/Marketing/Campaigns` |
| 3 | `/Marketing/Campaigns/Q1-2024` |
| 4 | `/Marketing/Campaigns/Q1-2024/Social` |
| 5 | `/Marketing/Campaigns/Q1-2024/Social/Instagram` |
| 6 | `/Marketing/Campaigns/Q1-2024/Social/Instagram/Stories` |

Attempting to create a folder at level 7 or deeper returns a `400 Bad Request` error.

### Root Folder

- **Auto-created** when the first media operation occurs for a workspace
- **Cannot be deleted** or renamed
- **Default location** for media not placed in a specific folder
- **Identified by** `folder_id = "root"` or `parent_id = null`

---

## Endpoints

### List Contents

List folders and media in a specific folder (or root).

```
GET /media?folder_id={folder_id}
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `folder_id` | string | No | `root` | Folder to list (use `root` for root folder) |

#### Headers

```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
```

#### Response

**Success (200 OK):**
```json
{
    "folder": {
        "id": "folder-uuid-123",
        "name": "Marketing",
        "path": "/Marketing",
        "parent_id": "root",
        "level": 1,
        "created_at": "2024-01-15T10:30:00Z",
        "created_by": "user-123"
    },
    "breadcrumbs": [
        { "id": "root", "name": "Root" },
        { "id": "folder-uuid-123", "name": "Marketing" }
    ],
    "folders": [
        {
            "id": "folder-uuid-456",
            "name": "Campaigns",
            "path": "/Marketing/Campaigns",
            "level": 2,
            "item_count": 5,
            "created_at": "2024-01-16T09:00:00Z"
        }
    ],
    "media": [
        {
            "id": "media-uuid-789",
            "name": "brand-guide.pdf",
            "mime_type": "application/pdf",
            "size": 2048576,
            "thumbnail_url": "https://...",
            "created_at": "2024-01-17T14:20:00Z",
            "created_by": "user-456"
        }
    ]
}
```

**Root folder (200 OK):**
```json
{
    "folder": {
        "id": "root",
        "name": "Root",
        "path": "/",
        "parent_id": null,
        "level": 0
    },
    "breadcrumbs": [
        { "id": "root", "name": "Root" }
    ],
    "folders": [...],
    "media": [...]
}
```

---

### Get Upload URL

Request a presigned S3 URL for uploading a file.

```
POST /media/upload
```

#### Request

**Headers:**
```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
Content-Type: application/json
```

**Body:**
```json
{
    "folder_id": "folder-uuid-123",
    "file_name": "banner.png",
    "mime_type": "image/png",
    "size": 102400
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `folder_id` | string | No | Target folder (default: `root`) |
| `file_name` | string | Yes | Original file name |
| `mime_type` | string | Yes | MIME type of the file |
| `size` | number | Yes | File size in bytes |

#### Response

**Success (201 Created):**
```json
{
    "media_id": "media-uuid-abc",
    "upload_url": "https://s3.ap-southeast-2.amazonaws.com/bucket/...",
    "upload_fields": {
        "key": "workspaces/acme-corp/media-uuid-abc/banner.png",
        "Content-Type": "image/png",
        "x-amz-meta-media-id": "media-uuid-abc"
    },
    "expires_at": "2024-01-20T12:00:00Z"
}
```

**Client Upload Flow:**
```javascript
// 1. Get presigned URL
const { upload_url, upload_fields, media_id } = await getUploadUrl(file);

// 2. Upload to S3
const formData = new FormData();
Object.entries(upload_fields).forEach(([key, value]) => {
    formData.append(key, value);
});
formData.append('file', file);

await fetch(upload_url, {
    method: 'POST',
    body: formData,
});

// 3. Confirm upload (optional - or use S3 event trigger)
await confirmUpload(media_id);
```

---

### Create Folder

Create a new folder within the workspace.

```
POST /media/folders
```

#### Request

**Headers:**
```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
Content-Type: application/json
```

**Body:**
```json
{
    "parent_id": "folder-uuid-123",
    "name": "Q1-2024"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_id` | string | No | Parent folder ID (default: `root`) |
| `name` | string | Yes | Folder name (1-255 chars) |

#### Response

**Success (201 Created):**
```json
{
    "id": "folder-uuid-789",
    "name": "Q1-2024",
    "path": "/Marketing/Campaigns/Q1-2024",
    "parent_id": "folder-uuid-123",
    "level": 3,
    "created_at": "2024-01-20T10:00:00Z",
    "created_by": "user-123"
}
```

**Max Depth Exceeded (400 Bad Request):**
```json
{
    "message": "Maximum folder depth (7 levels) exceeded"
}
```

**Duplicate Name (409 Conflict):**
```json
{
    "message": "Folder 'Q1-2024' already exists in this location"
}
```

---

### Get Media Details

Get detailed information about a specific media item.

```
GET /media/{media_id}
```

#### Headers

```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
```

#### Response

**Success (200 OK):**
```json
{
    "id": "media-uuid-789",
    "name": "banner.png",
    "path": "/Marketing/Campaigns/Q1-2024/banner.png",
    "folder_id": "folder-uuid-456",
    "mime_type": "image/png",
    "size": 102400,
    "s3_key": "workspaces/acme-corp/media-uuid-789/banner.png",
    "thumbnail_url": "https://...",
    "metadata": {
        "width": 1920,
        "height": 1080
    },
    "created_at": "2024-01-17T14:20:00Z",
    "created_by": "user-456",
    "updated_at": "2024-01-18T09:00:00Z"
}
```

---

### Get Download URL

Get a presigned S3 URL for downloading a media item.

```
GET /media/{media_id}/download
```

#### Headers

```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
```

#### Response

**Success (200 OK):**
```json
{
    "download_url": "https://s3.ap-southeast-2.amazonaws.com/bucket/...",
    "file_name": "banner.png",
    "mime_type": "image/png",
    "size": 102400,
    "expires_at": "2024-01-20T12:00:00Z"
}
```

---

### Move Item

Move a media item or folder to a different location.

```
PATCH /media/{item_id}/move
```

#### Request

**Headers:**
```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
Content-Type: application/json
```

**Body:**
```json
{
    "target_folder_id": "folder-uuid-new",
    "item_type": "media"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target_folder_id` | string | Yes | Destination folder ID |
| `item_type` | string | Yes | `media` or `folder` |

#### Response

**Success (200 OK):**
```json
{
    "id": "media-uuid-789",
    "name": "banner.png",
    "path": "/Products/banner.png",
    "folder_id": "folder-uuid-new",
    "moved_at": "2024-01-20T11:00:00Z"
}
```

**Circular Reference (400 Bad Request):**
```json
{
    "message": "Cannot move folder into itself or its descendants"
}
```

**Max Depth Exceeded (400 Bad Request):**
```json
{
    "message": "Move would exceed maximum folder depth (7 levels)"
}
```

---

### Rename Item

Rename a media item or folder.

```
PATCH /media/{item_id}/rename
```

#### Request

**Headers:**
```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
Content-Type: application/json
```

**Body:**
```json
{
    "name": "new-banner.png",
    "item_type": "media"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | New name (1-255 chars) |
| `item_type` | string | Yes | `media` or `folder` |

#### Response

**Success (200 OK):**
```json
{
    "id": "media-uuid-789",
    "name": "new-banner.png",
    "path": "/Marketing/Campaigns/Q1-2024/new-banner.png",
    "renamed_at": "2024-01-20T11:30:00Z"
}
```

**Cannot Rename Root (400 Bad Request):**
```json
{
    "message": "Cannot rename root folder"
}
```

---

### Delete Item

Delete a media item or folder (with cascade for folders).

```
DELETE /media/{item_id}?item_type={item_type}
```

#### Headers

```
Cookie: Authentication=<token>; Identifier=<jwt>; Workspace=<jwt>
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_type` | string | Yes | `media` or `folder` |

#### Response

**Success (200 OK) - Media:**
```json
{
    "message": "Media deleted successfully",
    "id": "media-uuid-789",
    "deleted_at": "2024-01-20T12:00:00Z"
}
```

**Success (200 OK) - Folder with cascade:**
```json
{
    "message": "Folder and contents deleted successfully",
    "id": "folder-uuid-123",
    "deleted_items": {
        "folders": 3,
        "media": 12
    },
    "deleted_at": "2024-01-20T12:00:00Z"
}
```

**Cannot Delete Root (400 Bad Request):**
```json
{
    "message": "Cannot delete root folder"
}
```

---

## Data Models

### Media

```typescript
interface Media {
    id: string;              // UUID
    workspace_id: string;    // Parent workspace
    folder_id: string;       // Parent folder (or "root")
    name: string;            // File name
    path: string;            // Full path from root
    mime_type: string;       // MIME type
    size: number;            // Size in bytes
    s3_key: string;          // S3 object key
    thumbnail_url?: string;  // Generated thumbnail URL
    metadata?: {             // File-specific metadata
        width?: number;
        height?: number;
        duration?: number;   // For video/audio
    };
    status: 'pending' | 'ready' | 'error';
    created_at: string;      // ISO timestamp
    created_by: string;      // User ID
    updated_at?: string;     // ISO timestamp
}
```

### Folder

```typescript
interface Folder {
    id: string;              // UUID (or "root")
    workspace_id: string;    // Parent workspace
    parent_id: string | null; // Parent folder (null for root)
    name: string;            // Folder name
    path: string;            // Full path from root
    level: number;           // Nesting level (0-6)
    item_count?: number;     // Cached count of direct children
    created_at: string;      // ISO timestamp
    created_by: string;      // User ID
}
```

### CreateFolderInput

```typescript
interface CreateFolderInput {
    parent_id?: string;      // Optional, defaults to "root"
    name: string;            // Required, 1-255 chars
}
```

### UploadMediaInput

```typescript
interface UploadMediaInput {
    folder_id?: string;      // Optional, defaults to "root"
    file_name: string;       // Required
    mime_type: string;       // Required
    size: number;            // Required, max 100MB
}
```

### MoveItemInput

```typescript
interface MoveItemInput {
    target_folder_id: string; // Required
    item_type: 'media' | 'folder'; // Required
}
```

### RenameItemInput

```typescript
interface RenameItemInput {
    name: string;            // Required, 1-255 chars
    item_type: 'media' | 'folder'; // Required
}
```

---

## DynamoDB Schema

**Table:** `sales-sync-media`

### Single Table Design

| Pattern | pk | sk | Attributes |
|---------|----|----|------------|
| Folder | `WS#{workspace_id}` | `FOLDER#{folder_id}` | `name, path, parent_id, level, ...` |
| Media | `WS#{workspace_id}` | `MEDIA#{media_id}` | `name, folder_id, mime_type, size, ...` |
| Folder contents | `FOLDER#{workspace_id}#{folder_id}` | `{FOLDER\|MEDIA}#{id}` | Sparse - for listing |
| Path lookup | `PATH#{workspace_id}` | `{path}` | `item_type, item_id` |

### Global Secondary Indexes

**GSI1: folder-contents-index**

| GSI1 PK | GSI1 SK | Purpose |
|---------|---------|---------|
| `FOLDER#{workspace_id}#{folder_id}` | `{type}#{name}` | List folder contents sorted by name |

**GSI2: path-index**

| GSI2 PK | GSI2 SK | Purpose |
|---------|---------|---------|
| `PATH#{workspace_id}` | `{path}` | Lookup by full path |

### Access Patterns

| Access Pattern | Operation | Key Condition |
|----------------|-----------|---------------|
| Get folder by ID | GetItem | `pk = WS#{workspace_id}`, `sk = FOLDER#{folder_id}` |
| Get media by ID | GetItem | `pk = WS#{workspace_id}`, `sk = MEDIA#{media_id}` |
| List folder contents | Query GSI1 | `pk = FOLDER#{workspace_id}#{folder_id}` |
| List only folders | Query GSI1 | `pk = FOLDER#{workspace_id}#{folder_id}`, `sk begins_with FOLDER#` |
| List only media | Query GSI1 | `pk = FOLDER#{workspace_id}#{folder_id}`, `sk begins_with MEDIA#` |
| Get item by path | Query GSI2 | `pk = PATH#{workspace_id}`, `sk = {path}` |
| Get all descendants | Query GSI2 | `pk = PATH#{workspace_id}`, `sk begins_with {folder_path}/` |

### Example Items

**Root folder:**
```json
{
    "pk": "WS#acme-corp",
    "sk": "FOLDER#root",
    "id": "root",
    "name": "Root",
    "path": "/",
    "parent_id": null,
    "level": 0,
    "workspace_id": "acme-corp",
    "created_at": "2024-01-01T00:00:00Z",
    "GSI1PK": "FOLDER#acme-corp#root",
    "GSI1SK": "FOLDER#Root"
}
```

**Nested folder:**
```json
{
    "pk": "WS#acme-corp",
    "sk": "FOLDER#folder-uuid-123",
    "id": "folder-uuid-123",
    "name": "Marketing",
    "path": "/Marketing",
    "parent_id": "root",
    "level": 1,
    "workspace_id": "acme-corp",
    "created_at": "2024-01-15T10:30:00Z",
    "created_by": "user-123",
    "GSI1PK": "FOLDER#acme-corp#root",
    "GSI1SK": "FOLDER#Marketing",
    "GSI2PK": "PATH#acme-corp",
    "GSI2SK": "/Marketing"
}
```

**Media item:**
```json
{
    "pk": "WS#acme-corp",
    "sk": "MEDIA#media-uuid-789",
    "id": "media-uuid-789",
    "name": "banner.png",
    "path": "/Marketing/banner.png",
    "folder_id": "folder-uuid-123",
    "mime_type": "image/png",
    "size": 102400,
    "s3_key": "workspaces/acme-corp/media-uuid-789/banner.png",
    "status": "ready",
    "workspace_id": "acme-corp",
    "created_at": "2024-01-17T14:20:00Z",
    "created_by": "user-456",
    "GSI1PK": "FOLDER#acme-corp#folder-uuid-123",
    "GSI1SK": "MEDIA#banner.png",
    "GSI2PK": "PATH#acme-corp",
    "GSI2SK": "/Marketing/banner.png"
}
```

### Cascade Delete Strategy

When deleting a folder, use GSI2 to find all descendants:

```typescript
// 1. Query all items with path starting with folder's path
const descendants = await queryGSI2({
    pk: `PATH#${workspace_id}`,
    sk_begins_with: `${folder_path}/`
});

// 2. Batch delete all items (DynamoDB BatchWriteItem, max 25 per batch)
// 3. Delete S3 objects for media items
// 4. Delete the folder itself
```

---

## Error Responses

### 400 Bad Request

| Error | Message |
|-------|---------|
| Validation failed | `"Validation failed"` with `issues` array |
| Max depth exceeded | `"Maximum folder depth (7 levels) exceeded"` |
| Circular move | `"Cannot move folder into itself or its descendants"` |
| Move depth exceeded | `"Move would exceed maximum folder depth (7 levels)"` |
| Cannot rename root | `"Cannot rename root folder"` |
| Cannot delete root | `"Cannot delete root folder"` |
| Invalid item type | `"item_type must be 'media' or 'folder'"` |

### 401 Unauthorized

```json
{
    "message": "Unauthorize Error"
}
```

### 403 Forbidden

```json
{
    "message": "Access denied to workspace 'acme-corp'"
}
```

### 404 Not Found

| Error | Message |
|-------|---------|
| Media not found | `"Media 'media-uuid-789' not found"` |
| Folder not found | `"Folder 'folder-uuid-123' not found"` |
| User not found | `"User not found"` |

### 409 Conflict

```json
{
    "message": "Folder 'Q1-2024' already exists in this location"
}
```

### 413 Payload Too Large

```json
{
    "message": "File size exceeds maximum allowed (100MB)"
}
```

---

## Examples

### cURL

**List root folder:**
```bash
curl -X GET "https://api.salesync.biz/media" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..."
```

**List specific folder:**
```bash
curl -X GET "https://api.salesync.biz/media?folder_id=folder-uuid-123" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..."
```

**Create folder:**
```bash
curl -X POST "https://api.salesync.biz/media/folders" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "parent_id": "root",
    "name": "Marketing"
  }'
```

**Get upload URL:**
```bash
curl -X POST "https://api.salesync.biz/media/upload" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "folder_id": "folder-uuid-123",
    "file_name": "banner.png",
    "mime_type": "image/png",
    "size": 102400
  }'
```

**Move item:**
```bash
curl -X PATCH "https://api.salesync.biz/media/media-uuid-789/move" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "target_folder_id": "folder-uuid-456",
    "item_type": "media"
  }'
```

**Delete folder (cascade):**
```bash
curl -X DELETE "https://api.salesync.biz/media/folder-uuid-123?item_type=folder" \
  -H "Cookie: Authentication=token123; Identifier=eyJ...; Workspace=eyJ..."
```

### JavaScript (fetch)

**Upload file flow:**
```javascript
async function uploadFile(folderId, file) {
    // Workspace is automatically included via Workspace cookie
    
    // 1. Get presigned URL
    const response = await fetch('https://api.salesync.biz/media/upload', {
        method: 'POST',
        credentials: 'include',  // Sends cookies
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            folder_id: folderId,
            file_name: file.name,
            mime_type: file.type,
            size: file.size,
        }),
    });

    const { upload_url, upload_fields, media_id } = await response.json();

    // 2. Upload to S3
    const formData = new FormData();
    Object.entries(upload_fields).forEach(([key, value]) => {
        formData.append(key, value);
    });
    formData.append('file', file);

    await fetch(upload_url, {
        method: 'POST',
        body: formData,
    });

    return media_id;
}
```

**List folder contents:**
```javascript
async function listFolder(folderId = 'root') {
    const params = new URLSearchParams({ folder_id: folderId });

    const response = await fetch(`https://api.salesync.biz/media?${params}`, {
        credentials: 'include',  // Sends cookies (including Workspace)
    });

    return response.json();
}
```

---

## Project Structure

```
media/
├── app.ts                          # Lambda entry point
├── default/
│   └── default.controller.ts       # GET /media (list contents)
├── upload/
│   └── upload.controller.ts        # POST /media/upload
├── folders/
│   └── folders.controller.ts       # POST /media/folders
├── item/
│   └── item.controller.ts          # GET/PATCH/DELETE /media/{id}
├── dtos/
│   └── media.dto.ts                # All Zod validation schemas
├── services/
│   ├── media.service.ts            # Media CRUD operations
│   ├── folder.service.ts           # Folder CRUD operations
│   └── s3.service.ts               # S3 presigned URL operations
├── errors/
│   └── media.errors.ts             # All custom error classes
├── bundle/                         # esbuild output
├── vendor/                         # shared.tgz
└── package.json
```

---

## Related Documentation

- [Sale Sync API](./SALE-SYNC-API.md) — Main API documentation
- [Workspace API](./WORKSPACE-API.md) — Workspace management
- [SAMJS Reference](./SAMJS-REFERENCE.md) — Framework documentation
- [Shared Middleware](./SHARED-MIDDLEWARE.md) — Workspace cookie extraction