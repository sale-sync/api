import type { LocationItem, LocationsContent } from '../types';

// Backward-compat for locations saved before the `propertyCount` -> `label` rename (2026-09-04).
// Records written before that rename only have `propertyCount`; `LocationItemSchema` now requires
// `label`, so an unmigrated item would fail write-API validation the next time the *whole* array is
// saved (editing any one location resubmits every item), and the public queries-api would serve
// `label: undefined` for it. Normalizes on read in both places instead of a one-off DynamoDB
// migration — legacy items self-heal to the new shape the next time they're actually saved, since
// the write path only ever constructs `label`, never `propertyCount`.
export function normalizeLocationItem(item: LocationItem & { propertyCount?: string }): LocationItem {
    if (typeof item.label === 'string') return item;
    return { ...item, label: typeof item.propertyCount === 'string' ? item.propertyCount : '' };
}

export function normalizeLocationsContent(content: LocationsContent | null): LocationsContent | null {
    if (!content) return content;
    return { locations: content.locations.map(normalizeLocationItem) };
}
