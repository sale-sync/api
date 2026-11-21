import type { PetFriendly, Property, Unit } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;

// size x Property rate (Baht per sqm). null unless both are present, so there is never a
// calculation or fallback when either side is empty.
export function computeUnitFee(unitSize: number | null | undefined, rate: number | null | undefined): number | null {
    if (unitSize == null || rate == null) return null;
    return round2(unitSize * rate);
}

// A house is charged by land size, everything else (condo, ...) by unit size.
export function feeSize(unit: Partial<Pick<Unit, 'unitSize' | 'landSize'>>, propertyType: Property['type']): number | null {
    return (propertyType === 'house' ? unit.landSize : unit.unitSize) ?? null;
}

type FeeUnit = Pick<
    Unit,
    'unitSize' | 'landSize' | 'commonAreaFees' | 'sinkingFund' | 'commonAreaFeesOverridden' | 'sinkingFundOverridden'
>;

// A fee counts as overridden only when flagged AND it has a value — clearing the field hands the
// unit back to auto-calculation. Non-overridden fees are always size x Property rate, so they
// follow changes to either side. (Records written before the flags existed are converted first, in
// normalizeStoredProperty: their flat amount becomes an overridden value.)
export function normalizeUnitFees(
    unit: Partial<FeeUnit>,
    property: Pick<Property, 'type' | 'commonAreaFees' | 'sinkingFund'>,
): Pick<Unit, 'commonAreaFees' | 'sinkingFund' | 'commonAreaFeesOverridden' | 'sinkingFundOverridden'> {
    const caOverridden = unit.commonAreaFeesOverridden === true && unit.commonAreaFees != null;
    const sfOverridden = unit.sinkingFundOverridden === true && unit.sinkingFund != null;
    const size = feeSize(unit, property.type);
    return {
        commonAreaFees: caOverridden ? (unit.commonAreaFees as number) : computeUnitFee(size, property.commonAreaFees),
        sinkingFund: sfOverridden ? (unit.sinkingFund as number) : computeUnitFee(size, property.sinkingFund),
        commonAreaFeesOverridden: caOverridden,
        sinkingFundOverridden: sfOverridden,
    };
}

// Normalizes a stored property on read, so records written before these fields existed (and the
// pre-change boolean petFriendly/multipurposeRoom and flat fee amounts on units) come back in the
// current shape without a bulk migration. Old values are converted, not dropped. Nothing is written
// back; the next save persists the converted shape.
const legacyPets = (v: unknown): PetFriendly | null => (v === true ? 'Pet Friendly' : null);
// Booking Fees used to be free text. A plain amount ("50,000", "฿50000") converts; anything else
// ("10% of sell price") cannot be a number and is dropped.
const legacyBookingFees = (v: unknown): number | null => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const n = Number(v.replace(/[,\s฿]|THB|baht/gi, ''));
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};
const legacyRooms = (v: unknown): number | null => (v === true ? 1 : null);

// Before the override flags existed, the stored fee was always a user-typed flat amount. The flags
// are always written explicitly now (true or false), so an absent flag marks a legacy record: keep
// its amount as an overridden unit fee.
function legacyFlatFeesAsOverrides(unit: Unit): Unit {
    return {
        ...unit,
        commonAreaFeesOverridden: unit.commonAreaFeesOverridden ?? unit.commonAreaFees != null,
        sinkingFundOverridden: unit.sinkingFundOverridden ?? unit.sinkingFund != null,
    };
}

export function normalizeStoredProperty(stored: Property): Property {
    const property = {
        ...stored,
        // Booleans added by earlier features: records saved before them lack the keys entirely.
        isLeasehold: stored.isLeasehold ?? false,
        swimmingPool: stored.swimmingPool ?? false,
        completionDate: stored.completionDate ?? null,
        totalFloor: stored.totalFloor ?? null,
        petFriendly: (stored.petFriendly as PetFriendly | undefined) ?? 'No Pets',
        commonAreaFees: stored.commonAreaFees ?? null,
        sinkingFund: stored.sinkingFund ?? null,
        videos: stored.videos ?? [],
    };
    return {
        ...property,
        units: (stored.units ?? []).map((unit) => ({
            ...unit,
            // Legacy booleans: true -> 'Pet Friendly' / 1 room; false -> unset (pets: follow the
            // property; rooms: none).
            petFriendly: typeof unit.petFriendly === 'string' ? unit.petFriendly : legacyPets(unit.petFriendly),
            multipurposeRoom: typeof unit.multipurposeRoom === 'number' ? unit.multipurposeRoom : legacyRooms(unit.multipurposeRoom),
            images: unit.images ?? [],
            maidRoom: unit.maidRoom ?? null,
            unitLayouts: unit.unitLayouts ?? [],
            unitDetail: unit.unitDetail ?? null,
            subType: unit.subType ?? null,
            totalFloor: unit.totalFloor ?? null,
            bookingFees: legacyBookingFees(unit.bookingFees),
            videos: unit.videos ?? [],
            poolVilla: unit.poolVilla ?? false,
            paymentOptions: unit.paymentOptions?.length ? unit.paymentOptions : ['Complete'],
            ...normalizeUnitFees(legacyFlatFeesAsOverrides(unit), property),
        })),
    };
}
