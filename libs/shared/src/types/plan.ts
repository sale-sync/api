export type Plan = {
    uuid: string;
    plan_id: string; // slug e.g. "basic" | "pro" — must be unique
    name: string;
    info: string;
    included: string[];
    price: number; // annual amount charged, not monthly — e.g. Basic 240, Pro 600 (displayed as $20/mo, $50/mo but billed yearly)
    currency: string; // e.g. "USD"
    billing_interval: 'yearly'; // fixed for now — no monthly billing path exists
};
