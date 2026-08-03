import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Router, withCORS } from '@devyethiha/samjs';
import DefaultController from './default/default.controller';
import ByIdController from './by-id/by-id.controller';
import UsersController from './users/users.controller';
import ProfileController from './profile/profile.controller';
import TeamController from './team/team.controller';
import TeamMemberController from './team-member/team-member.controller';
import TemplatesController from './templates/templates.controller';
import ThemeController from './templates/theme/theme.controller';
import BrandingController from './branding/branding.controller';
import { OrganisationService } from './services/organisation.service';
import { TemplateService } from './services/template.service';
import { WebsiteTemplateService } from './services/website-template.service';
import { BrandingService } from './services/branding.service';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const region = 'ap-southeast-2';
    try {
        const router = new Router(
            event,
            region,
            [
                { controller: DefaultController, services: [OrganisationService] },
                { controller: ByIdController, services: [OrganisationService] },
                { controller: UsersController, services: [OrganisationService] },
                { controller: ProfileController, services: [OrganisationService] },
                { controller: TeamController, services: [OrganisationService] },
                { controller: TeamMemberController, services: [OrganisationService] },
                { controller: TemplatesController, services: [TemplateService] },
                { controller: ThemeController, services: [WebsiteTemplateService] },
                { controller: BrandingController, services: [OrganisationService, BrandingService] },
            ],
            '/organisations',
        );

        return await router.handle();
    } catch (err) {
        console.log({ err });
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'some error happened',
            }),
        };
    }
}

export const lambdaHandler = withCORS(main, [
    'https://app.salesync.biz',
    'https://staging.salesync.biz',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://app.salesync.local',
]);
