// ============================================================================
// Folder Already Exists Error
// ============================================================================

import { MAX_FOLDER_DEPTH, MAX_ITEMS_IN_FOLDER, MAX_SUBFOLDERS_IN_FOLDER } from '../services/media.constants';

export class FolderAlreadyExistsError extends Error {
    constructor(folderName: string) {
        super(`Folder '${folderName}' already exists in this location`);
        this.name = 'FolderAlreadyExistsError';
    }
}

export class FolderItemLimitExceededError extends Error {
    constructor() {
        super(`Folder has reached the maximum limit of ${MAX_ITEMS_IN_FOLDER} media items`);
        this.name = 'FolderItemLimitExceededError';
    }
}

export class PendingMediaNotFoundError extends Error {
    constructor(mediaId: string) {
        super(`Pending media '${mediaId}' not found or already confirmed`);
        this.name = 'PendingMediaNotFoundError';
    }
}

export class SubfolderLimitExceededError extends Error {
    constructor() {
        super(`Folder has reached the maximum limit of ${MAX_SUBFOLDERS_IN_FOLDER} subfolders`);
        this.name = 'SubfolderLimitExceededError';
    }
}

// ============================================================================
// User try to rename Folder with same name
// ============================================================================

export class SameNameError extends Error {
    constructor(name: string) {
        super(`Folder is already named "${name}"`);
        this.name = 'SameNameError';
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
        super(`Maximum folder depth (${MAX_FOLDER_DEPTH} levels) exceeded`);
        this.name = 'MaxDepthExceededError';
    }
}

// ============================================================================
// Move Depth Exceeded Error
// ============================================================================

export class MoveDepthExceededError extends Error {
    constructor() {
        super(`Move would exceed maximum folder depth (${MAX_FOLDER_DEPTH} levels)`);
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
    organisationId: string;

    constructor(organisationId: string) {
        super(`Access denied to organisation '${organisationId}'`);
        this.name = 'AccessDeniedError';
        this.organisationId = organisationId;
    }
}
