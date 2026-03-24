import { IFormObj } from '@sales-sync/shared';

// Refractor: Need to use zod for DTO
export type ICreateFormDto = {
    workspace_uuid: string;
} & Omit<IFormObj, 'id'>;
