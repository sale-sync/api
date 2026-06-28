import { IFormObj } from '@sales-sync/shared';

// Refractor: Need to use zod for DTO
export type ICreateFormDto = {
    organisation_uuid: string;
} & Omit<IFormObj, 'id'>;
