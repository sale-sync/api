import { normalizeStoredProperty, normalizeUnitFees } from '@sale-sync/shared/src/utils/property';
import type { Property, Unit } from '@sale-sync/shared';

const rates = { commonAreaFees: 50, sinkingFund: 600 };

describe('normalizeUnitFees', () => {
    it('charges a condo by unit size', () => {
        const fees = normalizeUnitFees({ unitSize: 40, landSize: 200 }, { type: 'condo', ...rates });
        expect(fees.commonAreaFees).toBe(2000);
        expect(fees.sinkingFund).toBe(24000);
    });

    it('charges a house by land size, ignoring unit size', () => {
        const fees = normalizeUnitFees({ unitSize: 40, landSize: 200 }, { type: 'house', ...rates });
        expect(fees.commonAreaFees).toBe(10000);
        expect(fees.sinkingFund).toBe(120000);
    });

    it('calculates nothing for a house without land size', () => {
        const fees = normalizeUnitFees({ unitSize: 40, landSize: null }, { type: 'house', ...rates });
        expect(fees.commonAreaFees).toBeNull();
        expect(fees.sinkingFund).toBeNull();
    });

    it('keeps an overridden fee', () => {
        const fees = normalizeUnitFees(
            { landSize: 200, commonAreaFees: 999, commonAreaFeesOverridden: true },
            { type: 'house', ...rates },
        );
        expect(fees.commonAreaFees).toBe(999);
        expect(fees.sinkingFund).toBe(120000);
    });
});

describe('normalizeStoredProperty', () => {
    const stored = (unit: Partial<Unit>) => ({ type: 'condo', units: [unit] }) as unknown as Property;

    it.each([
        ['50,000', 50000],
        ['฿50000', 50000],
        ['10% of sell price', null],
        ['', null],
        [75000, 75000],
        [null, null],
    ])('converts legacy booking fees %p to %p', (value, expected) => {
        const [unit] = normalizeStoredProperty(stored({ bookingFees: value as never })).units;
        expect(unit.bookingFees).toBe(expected);
    });

    it('defaults the new unit fields', () => {
        const [unit] = normalizeStoredProperty(stored({})).units;
        expect(unit).toMatchObject({ maidRoom: null, unitLayouts: [], unitDetail: null, subType: null });
    });
});
