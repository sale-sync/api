// ISO 3166-1 alpha-2, deliberately kept open rather than a closed enum — launch markets are
// TH and AU, more added as the business expands worldwide.
// See docs/api/dynamodb/access-patterns/properties.md and docs/api/market-behaviour.md.
export type PropertyCountry = string;

// ISO 4217, deliberately kept open rather than a closed enum — same rationale as PropertyCountry.
// Defaults from the owning org's market (see MARKET_CURRENCY in organisation.ts) but can be
// overridden per-property.
export type PropertyCurrency = string;

// State/province — only meaningful for markets that search by it (e.g. AU: "NSW", "VIC").
// null for markets where it isn't part of how buyers search (e.g. TH).
export type PropertyRegion = string | null;

// area_key (a single string conflating city- and suburb-level granularity) has been replaced by
// explicit, market-scoped fields — see docs/api/dynamodb/access-patterns/properties.md and
// docs/api/market-behaviour.md. TH-style markets populate city (+ optional neighborhood); AU-style
// markets populate region (above) + suburb. Neither city/neighborhood nor suburb is a fixed enum —
// org-defined slugs, same convention area_key used.
export type PropertyCity = string | null;
export type PropertyNeighborhood = string | null;
export type PropertySuburb = string | null;
// Populated for either market (TH: optional, foreign-buyer shipping/documentation; AU: required,
// primary search field) — filtered standalone, not nested under city/suburb, so it isn't nullable
// only-per-market the way city/suburb are.
export type PropertyPostcode = string | null;

export type PropertyType = 'house' | 'condo' | 'commercial' | 'land';

// Free text (not a fixed enum — default suggestions only, custom values are accepted) describing
// a finer classification within `type`. Meaning depends on `type`: "High Rise"/"Low Rise" for
// condo, "Attached House"/etc. for house, "Shop House"/etc. for commercial. `land` has no
// sub-type at all — stays null. Not market-scoped (unlike city/suburb/region above).
export type PropertySubType = string | null;

// Audience-based visibility (content-scope-visibility): 'public' = the org's public website,
// 'staff' = dashboard, all members except guest-role, 'guest' = dashboard, all members including
// guest-role. Not a strict hierarchy — 'guest' is the widest internal audience, not the narrowest.
export type PropertyScope = 'public' | 'staff' | 'guest';

// A unit can be listed for multiple actions at once (e.g. both Sell and Rent). 'sell' pairs with
// the existing sellPrice/sellDiscountPrice/sellMaxPrice; 'sold'/'rent' each get their own price
// field (soldPrice/rentPrice) rather than reusing sell*.
export type UnitAction = 'sell' | 'rent' | 'sold';

// Per-unit, independent of Property.isLeasehold — foreign freehold condo ownership in Thailand is
// capped at 49% per building, so units within the same property can genuinely differ. Optional,
// no default: stays null until a user explicitly sets it.
export type UnitOwnership = 'Freehold' | 'Leasehold';

// Project-level completion status. Optional, no default: stays null until a user explicitly sets it.
export type PropertyCompletion = 'Ready to Move' | 'Off Plan';

// A unit can offer multiple payment options at once (checkbox group, not radio) — mirrors
// UnitAction's multi-select shape. Defaults to ['Complete'].
export type PaymentOption = 'Complete' | 'Installment';
export type FinalPaymentTimeline = 'Within 30 Days from Contract Date' | 'Project Completion Date';
export type InstallmentPaymentTimeline =
    | 'Pay every 1 Month'
    | 'Pay every 3 Months'
    | 'Pay every 6 Months'
    | 'Pay every 12 Months';

export type Unit = {
    uuid: string;
    title: string;
    image: string | null;
    actions: UnitAction[];
    sellPrice: number | null;
    sellDiscountPrice: number | null;
    sellMaxPrice: number | null;
    soldPrice: number | null;
    rentPrice: number | null;
    beds: number | null;
    baths: number | null;
    hall: number | null;
    kitchen: number | null;
    pantry: number | null;
    car: number | null;
    unitSize: number | null;
    landSize: number | null;
    condition: string | null;
    furnishing: string | null;
    ownership: UnitOwnership | null;
    // Amenity flags — non-nullable, default false, same pattern as Property.isLeasehold.
    petFriendly: boolean;
    multipurposeRoom: boolean;
    // Private per-unit pool — not the shared project-level pool tracked in Property.swimmingPool.
    poolVilla: boolean;
    // Count/size fields, no default — same nullability pattern as hall/kitchen/etc.
    livingRoom: number | null;
    commonAreaFees: number | null;
    sinkingFund: number | null;
    // Free text — non-numeric content (e.g. "10% of sell price"), no default.
    bookingFees: string | null;
    contractFees: string | null;
    // Free text with a suggested default ("Within 14 Days from Booking Date") offered in the UI,
    // no default enforced at the type/API level — same pattern as condition/furnishing.
    contractFeesTimeline: string | null;
    // Multi-select, defaults to ['Complete']. Unchecking an option hides but doesn't clear its
    // conditional fields below — same precedent as actions/soldPrice/rentPrice.
    paymentOptions: PaymentOption[];
    finalPayment: string | null;
    finalPaymentTimeline: FinalPaymentTimeline | null;
    installmentPayment: string | null;
    installmentPaymentTimeline: InstallmentPaymentTimeline | null;
    currency: PropertyCurrency;
};

export type Property = {
    uuid: string;
    title: string;
    lat: number;
    lng: number;
    location: string;
    country: PropertyCountry;
    currency: PropertyCurrency;
    region: PropertyRegion;
    city: PropertyCity;
    neighborhood: PropertyNeighborhood;
    suburb: PropertySuburb;
    postcode: PropertyPostcode;
    type: PropertyType;
    subType: PropertySubType;
    scope: PropertyScope;
    // URL-safe identifier for the public read path (queries-api's GET /properties?slug=<slug>),
    // unique per-organisation (not globally). Nullable — records written before this field existed
    // have no slug and simply aren't publicly linkable until edited to add one.
    slug: string | null;
    sellPrice: number | null;
    sellDiscountPrice: number | null;
    sellMaxPrice: number | null;
    code: string | null;
    isLeasehold: boolean;
    // Project-level common-area amenity — not the private per-unit pool tracked in Unit.poolVilla.
    swimmingPool: boolean;
    completion: PropertyCompletion | null;
    brochure: string | null;
    image: string | null;
    images: string[];
    description: string | null;
    payment: string | null;
    units: Unit[];
    created_at: string;
    updated_at: string;
};
