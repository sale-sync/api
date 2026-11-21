// No hardcoded fallback: staging and prod use different literal table names, and a default here
// would mean a misconfigured staging deploy silently writes visitor submissions to the prod table
// instead of erroring.
export function getTable(): string {
    const table = process.env.ORGANISATION_TABLE_NAME;
    if (!table) throw new Error('ORGANISATION_TABLE_NAME environment variable is not set');
    return table;
}
