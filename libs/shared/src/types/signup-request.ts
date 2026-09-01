import type { BusinessCategory, Market } from './organisation';

export type SignupRequestStatus = 'pending' | 'approved' | 'rejected';

// Pending admin approval for a new organisation — created by POST /organisations instead of a live
// org (see backlogs/onboarding/children/organisation-approval-gate). Same field shape as
// CreateOrganisationInput plus request-lifecycle metadata. Stored in the existing
// sale-sync-organisation table (PK='SIGNUP', SK='META#{uuid}'), no new table.
export type SignupRequest = {
    uuid: string;
    organisation_id: string;
    organisation_name: string;
    business_category: BusinessCategory;
    template_id: string;
    plan_id: string;
    description?: string;
    address?: string;
    market: Market;
    status: SignupRequestStatus;
    requested_by_user_id: string;
    requested_by_email: string;
    created_at: string;
    reviewed_by_user_id?: string;
    reviewed_at?: string;
    rejection_reason?: string;
    resulting_organisation_uuid?: string;
};
