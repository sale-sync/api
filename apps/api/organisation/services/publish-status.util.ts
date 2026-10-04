import type { PublishStatusItem, PublishStatusKey, PublishStatusResponse } from '@sale-sync/shared/src/types';

// Pure derivation of the client-facing status from the stored PUBLISH_STATUS# item, kept separate
// from publish-status.ts's DynamoDB client so it stays unit-testable (same split as
// branding-color.util.ts). `page` is passed in because a missing item carries no page of its own.
export function computePublishStatus(
    page: PublishStatusKey,
    item: PublishStatusItem | null | undefined,
): PublishStatusResponse {
    if (!item) {
        return { page, publish_id: null, status: 'idle', expected: [], results: {}, reason: null, started_at: null };
    }

    const expected = item.expected ?? [];
    const results = item.results ?? {};
    const base = {
        page,
        publish_id: item.publish_id,
        expected,
        results,
        started_at: item.started_at ?? null,
    };

    // Nothing was invoked (env var unset, or no Hero/SEO/slug change), so there's nothing to wait for.
    if (expected.length === 0) {
        return { ...base, status: 'success', reason: null };
    }

    if (!expected.every((generator) => results[generator])) {
        return { ...base, status: 'generating', reason: null };
    }

    const failed = expected.map((generator) => results[generator]).find((result) => !result.ok);
    if (failed) {
        return { ...base, status: 'fail', reason: failed.reason ?? 'Page generation failed' };
    }

    return { ...base, status: 'success', reason: null };
}
