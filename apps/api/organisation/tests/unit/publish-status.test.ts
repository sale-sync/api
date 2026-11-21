import { describe, expect, it } from '@jest/globals';
import type { PublishStatusItem } from '@sale-sync/shared/src/types';
import { computePublishStatus } from '../../services/publish-status.util';

const finished_at = '2026-09-19T00:00:00.000Z';

function item(overrides: Partial<PublishStatusItem>): PublishStatusItem {
    return {
        publish_id: 'pid-1',
        page: 'articles',
        expected: [],
        results: {},
        started_at: '2026-09-19T00:00:00.000Z',
        ...overrides,
    };
}

describe('computePublishStatus', () => {
    it('is idle when the page has never been published', () => {
        expect(computePublishStatus('faq', null)).toEqual({
            page: 'faq',
            publish_id: null,
            status: 'idle',
            expected: [],
            results: {},
            reason: null,
            started_at: null,
        });
    });

    it('is success when nothing was expected to regenerate', () => {
        const res = computePublishStatus('articles', item({ expected: [] }));
        expect(res.status).toBe('success');
        expect(res.publish_id).toBe('pid-1');
        expect(res.reason).toBeNull();
    });

    it('is generating until every expected generator has reported', () => {
        const res = computePublishStatus(
            'articles',
            item({
                expected: ['article-listing-page', 'article-detail-page'],
                results: { 'article-listing-page': { ok: true, finished_at } },
            }),
        );
        expect(res.status).toBe('generating');
    });

    it('is success when every expected generator succeeded', () => {
        const res = computePublishStatus(
            'articles',
            item({
                expected: ['article-listing-page', 'article-detail-page'],
                results: {
                    'article-listing-page': { ok: true, finished_at },
                    'article-detail-page': { ok: true, finished_at },
                },
            }),
        );
        expect(res.status).toBe('success');
        expect(res.reason).toBeNull();
    });

    it('is fail with the first failing reason once all have reported', () => {
        const res = computePublishStatus(
            'articles',
            item({
                expected: ['article-listing-page', 'article-detail-page'],
                results: {
                    'article-listing-page': { ok: false, reason: 'no deployed site found', finished_at },
                    'article-detail-page': { ok: false, reason: 'second', finished_at },
                },
            }),
        );
        expect(res.status).toBe('fail');
        expect(res.reason).toBe('no deployed site found');
    });

    it('stays generating while a job is pending even if another already failed', () => {
        const res = computePublishStatus(
            'articles',
            item({
                expected: ['article-listing-page', 'article-detail-page'],
                results: { 'article-listing-page': { ok: false, reason: 'boom', finished_at } },
            }),
        );
        expect(res.status).toBe('generating');
    });
});
