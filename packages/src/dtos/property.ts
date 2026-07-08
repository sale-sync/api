import { z } from 'zod';

export const PropertyTypeSchema = z.enum(['house', 'condo', 'commercial', 'land']);

const UnitInputSchema = z.object({
    uuid: z.string().uuid().optional(),
    title: z.string(),
    image: z.string().nullable().optional(),
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    beds: z.number().nullable().optional(),
    baths: z.number().nullable().optional(),
    hall: z.number().nullable().optional(),
    kitchen: z.number().nullable().optional(),
    pantry: z.number().nullable().optional(),
    car: z.number().nullable().optional(),
    unitSize: z.number().nullable().optional(),
    landSize: z.number().nullable().optional(),
    size: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    furnishing: z.string().nullable().optional(),
});

export const CreatePropertySchema = z.object({
    org_uuid: z.string().uuid(),
    title: z.string(),
    typeLabel: z.string(),
    postedLabel: z.string(),
    lat: z.number(),
    lng: z.number(),
    location: z.string(),
    country: z.string().length(2),
    region: z.string().nullable().optional(),
    area_key: z.string(),
    type: PropertyTypeSchema,
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    code: z.string().nullable().optional(),
    isLeasehold: z.boolean().optional(),
    brochure: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    payment: z.string().nullable().optional(),
    units: z.array(UnitInputSchema).optional(),
});

export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>;

export const UpdatePropertySchema = z.object({
    org_uuid: z.string().uuid(),
    property_uuid: z.string().uuid(),
    title: z.string().optional(),
    typeLabel: z.string().optional(),
    postedLabel: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    location: z.string().optional(),
    country: z.string().length(2).optional(),
    region: z.string().nullable().optional(),
    area_key: z.string().optional(),
    type: PropertyTypeSchema.optional(),
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    code: z.string().nullable().optional(),
    isLeasehold: z.boolean().optional(),
    brochure: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    payment: z.string().nullable().optional(),
    units: z.array(UnitInputSchema).optional(),
});

export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;

export const DeletePropertySchema = z.object({
    org_uuid: z.string().uuid(),
    property_uuid: z.string().uuid(),
});

export type DeletePropertyInput = z.infer<typeof DeletePropertySchema>;
