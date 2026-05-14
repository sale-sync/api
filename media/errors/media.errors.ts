// ============================================================================
// Folder Already Exists Error
// ============================================================================

export class FolderAlreadyExistsError extends Error {
    constructor(folderName: string) {
        super(`Folder '${folderName}' already exists in this location`);
        this.name = 'FolderAlreadyExistsError';
    }
}

// ============================================================================
// Media Already Exists Error
// ============================================================================

export class MediaAlreadyExistsError extends Error {
    constructor(fileName: string) {
        super(`File '${fileName}' already exists in this location`);
        this.name = 'MediaAlreadyExistsError';
    }
}

// ============================================================================
// Max Depth Exceeded Error
// ============================================================================

export class MaxDepthExceededError extends Error {
    constructor() {
        super('Maximum folder depth (7 levels) exceeded');
        this.name = 'MaxDepthExceededError';
    }
}

// ============================================================================
// Move Depth Exceeded Error
// ============================================================================

export class MoveDepthExceededError extends Error {
    constructor() {
        super('Move would exceed maximum folder depth (7 levels)');
        this.name = 'MoveDepthExceededError';
    }
}

// ============================================================================
// Circular Move Error
// ============================================================================

export class CircularMoveError extends Error {
    constructor() {
        super('Cannot move folder into itself or its descendants');
        this.name = 'CircularMoveError';
    }
}

// ============================================================================
// Item Not Found Error
// ============================================================================

export class ItemNotFoundError extends Error {
    itemType: 'media' | 'folder';
    itemId: string;

    constructor(itemType: 'media' | 'folder', itemId: string) {
        const typeName = itemType === 'media' ? 'Media' : 'Folder';
        super(`${typeName} '${itemId}' not found`);
        this.name = 'ItemNotFoundError';
        this.itemType = itemType;
        this.itemId = itemId;
    }
}

// ============================================================================
// Cannot Modify Root Error
// ============================================================================

export class CannotModifyRootError extends Error {
    action: string;

    constructor(action: 'delete' | 'rename' | 'move') {
        super(`Cannot ${action} root folder`);
        this.name = 'CannotModifyRootError';
        this.action = action;
    }
}

// ============================================================================
// Access Denied Error
// ============================================================================

export class AccessDeniedError extends Error {
    workspaceId: string;

    constructor(workspaceId: string) {
        super(`Access denied to workspace '${workspaceId}'`);
        this.name = 'AccessDeniedError';
        this.workspaceId = workspaceId;
    }
}
