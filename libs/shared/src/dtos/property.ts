import { z } from 'zod';

export const PropertyTypeSchema = z.enum(['house', 'condo', 'commercial', 'land']);
export const PropertyScopeSchema = z.enum(['public', 'staff', 'guest']);
// Lowercase, numbers, single hyphens between segments — no leading/trailing/double hyphens.
export const PROPERTY_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PetFriendlySchema = z.enum(['Pet Friendly', 'Dog Friendly', 'Cat Friendly', 'No Pets']);
// youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/ — raw URL kept as entered.
export const YOUTUBE_URL_REGEX = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{11}(?:[?&#].*)?$/;
export const VideoUrlsSchema = z.array(z.string().regex(YOUTUBE_URL_REGEX, 'must be a YouTube link'));

export const UnitInputSchema = z.object({
    uuid: z.string().uuid().optional(),
    title: z.string(),
    image: z.string().nullable().optional(),
    actions: z.array(z.enum(['sell', 'rent', 'sold'])).min(1).optional(),
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    soldPrice: z.number().nullable().optional(),
    rentPrice: z.number().nullable().optional(),
    beds: z.number().nullable().optional(),
    baths: z.number().nullable().optional(),
    hall: z.number().nullable().optional(),
    kitchen: z.number().nullable().optional(),
    pantry: z.number().nullable().optional(),
    car: z.number().nullable().optional(),
    unitSize: z.number().nullable().optional(),
    landSize: z.number().nullable().optional(),
    condition: z.string().nullable().optional(),
    furnishing: z.string().nullable().optional(),
    ownership: z.enum(['Freehold', 'Leasehold']).nullable().optional(),
    petFriendly: PetFriendlySchema.nullable().optional(),
    multipurposeRoom: z.number().nullable().optional(),
    poolVilla: z.boolean().optional(),
    livingRoom: z.number().nullable().optional(),
    commonAreaFees: z.number().nullable().optional(),
    sinkingFund: z.number().nullable().optional(),
    commonAreaFeesOverridden: z.boolean().optional(),
    sinkingFundOverridden: z.boolean().optional(),
    videos: VideoUrlsSchema.optional(),
    bookingFees: z.string().nullable().optional(),
    contractFees: z.string().nullable().optional(),
    contractFeesTimeline: z.string().nullable().optional(),
    paymentOptions: z.array(z.enum(['Complete', 'Installment'])).optional(),
    finalPayment: z.string().nullable().optional(),
    finalPaymentTimeline: z.enum(['Within 30 Days from Contract Date', 'Project Completion Date']).nullable().optional(),
    installmentPayment: z.string().nullable().optional(),
    installmentPaymentTimeline: z
        .enum(['Pay every 1 Month', 'Pay every 3 Months', 'Pay every 6 Months', 'Pay every 12 Months'])
        .nullable()
        .optional(),
    currency: z.string().length(3).optional(),
});

export const CreatePropertySchema = z.object({
    title: z.string(),
    lat: z.number(),
    lng: z.number(),
    location: z.string(),
    country: z.string().length(2).optional(),
    currency: z.string().length(3).optional(),
    region: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    suburb: z.string().nullable().optional(),
    postcode: z.string().nullable().optional(),
    type: PropertyTypeSchema,
    subType: z.string().nullable().optional(),
    scope: PropertyScopeSchema.default('staff'),
    slug: z.string().regex(PROPERTY_SLUG_REGEX, 'slug must be lowercase letters, numbers, and hyphens only'),
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    code: z.string().nullable().optional(),
    isLeasehold: z.boolean().optional(),
    swimmingPool: z.boolean().optional(),
    completion: z.enum(['Ready to Move', 'Off Plan']).nullable().optional(),
    completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').nullable().optional(),
    totalFloor: z.number().int().nonnegative().nullable().optional(),
    petFriendly: PetFriendlySchema.optional(),
    commonAreaFees: z.number().nonnegative().nullable().optional(),
    sinkingFund: z.number().nonnegative().nullable().optional(),
    videos: VideoUrlsSchema.optional(),
    brochure: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    payment: z.string().nullable().optional(),
});

export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>;

export const UpdatePropertySchema = z.object({
    property_uuid: z.string().uuid(),
    title: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    location: z.string().optional(),
    country: z.string().length(2).optional(),
    currency: z.string().length(3).optional(),
    region: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    suburb: z.string().nullable().optional(),
    postcode: z.string().nullable().optional(),
    type: PropertyTypeSchema.optional(),
    subType: z.string().nullable().optional(),
    scope: PropertyScopeSchema.optional(),
    slug: z.string().regex(PROPERTY_SLUG_REGEX, 'slug must be lowercase letters, numbers, and hyphens only').optional(),
    sellPrice: z.number().nullable().optional(),
    sellDiscountPrice: z.number().nullable().optional(),
    sellMaxPrice: z.number().nullable().optional(),
    code: z.string().nullable().optional(),
    isLeasehold: z.boolean().optional(),
    swimmingPool: z.boolean().optional(),
    completion: z.enum(['Ready to Move', 'Off Plan']).nullable().optional(),
    completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').nullable().optional(),
    totalFloor: z.number().int().nonnegative().nullable().optional(),
    petFriendly: PetFriendlySchema.optional(),
    commonAreaFees: z.number().nonnegative().nullable().optional(),
    sinkingFund: z.number().nonnegative().nullable().optional(),
    videos: VideoUrlsSchema.optional(),
    brochure: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
    payment: z.string().nullable().optional(),
});

export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;

export const DeletePropertySchema = z.object({
    property_uuid: z.string().uuid(),
});

export type DeletePropertyInput = z.infer<typeof DeletePropertySchema>;

// Units are their own sub-resource (not part of the property's create/update payload): a property is
// created first and units are added later, each saved and published on its own.
export const CreateUnitSchema = UnitInputSchema.omit({ uuid: true }).extend({
    property_uuid: z.string().uuid(),
});

export type CreateUnitInput = z.infer<typeof CreateUnitSchema>;

export const UpdateUnitSchema = UnitInputSchema.omit({ uuid: true })
    .partial()
    .extend({
        property_uuid: z.string().uuid(),
        unit_uuid: z.string().uuid(),
    });

export type UpdateUnitInput = z.infer<typeof UpdateUnitSchema>;

export const DeleteUnitSchema = z.object({
    property_uuid: z.string().uuid(),
    unit_uuid: z.string().uuid(),
});

export type DeleteUnitInput = z.infer<typeof DeleteUnitSchema>;

// Publishes the property itself when unit_uuid is absent, otherwise just that one unit.
export const PublishPropertySchema = z.object({
    property_uuid: z.string().uuid(),
    unit_uuid: z.string().uuid().optional(),
});

export type PublishPropertyInput = z.infer<typeof PublishPropertySchema>;
