// organisation/services/organisation.service.ts

import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Service } from '@devyethiha/samjs';
import type { Organisation } from '@sales-sync/shared/src/types';
import { v4 as uuidv4 } from 'uuid';

type CreateOrganisationParam = {
    user_id: string;
    organisation_id: string;
    organisation_name: string;
};

export class OrganisationAlreadyExistsError extends Error {
    constructor(organisationId: string) {
        super(`Organisation '${organisationId}' already exists`);
        this.name = 'OrganisationAlreadyExistsError';
    }
}

export class OrganisationService extends Service {
    private DB_Client: DynamoDBClient;

    constructor(DB_Client: DynamoDBClient) {
        super('organisation');
        this.DB_Client = DB_Client;
    }

    public async createOrganisation(param: CreateOrganisationParam): Promise<void> {
        const data: Organisation = {
            uuid: uuidv4(),
            id: param.organisation_id,
            name: param.organisation_name,
        };

        try {
            await this.DB_Client.send(
                new PutCommand({
                    TableName: 'sale-sync-organisation',
                    Item: {
                        PK: 'ORG',
                        SK: 'META#' + data.id,
                        data: JSON.stringify(data),
                    },
                    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                }),
            );
        } catch (error) {
            if (error instanceof ConditionalCheckFailedException) {
                throw new OrganisationAlreadyExistsError(param.organisation_id);
            }
            throw error;
        }

        await this.DB_Client.send(
            new PutCommand({
                TableName: 'sale-sync-organisation',
                Item: {
                    PK: 'ORG#' + data.id,
                    SK: 'USER#' + param.user_id,
                },
            }),
        );
    }

    /**
     * Get all organisations a user belongs to
     * Uses GSI with SK as the HASH key -> query by "USER#<userId>"
     * Optionally hydrate organisation metadata via BatchGet
     */
    public async getOrganisationsByUserId(userId: string, options?: { hydrate?: boolean }) {
        const skUser = `USER#${userId}`;

        const res = await this.DB_Client.send(
            new QueryCommand({
                TableName: 'sale-sync-organisation',
                IndexName: 'inverted-index',
                KeyConditionExpression: 'SK = :skUser AND begins_with(PK, :orgPrefix)',
                ExpressionAttributeValues: {
                    ':skUser': skUser,
                    ':orgPrefix': 'ORG#',
                },
            }),
        );

        const organisationIds = res.Items?.map((it) => String(it.PK).replace('ORG#', '')) ?? [];

        if (!options?.hydrate || organisationIds.length === 0) {
            return { userId, organisations: organisationIds };
        }

        const keys = organisationIds.map((id) => ({
            PK: 'ORG',
            SK: `META#${id}`,
        }));

        const batch = await this.DB_Client.send(
            new BatchGetCommand({
                RequestItems: {
                    'sale-sync-organisation': {
                        Keys: keys,
                    },
                },
            }),
        );

        const items = batch.Responses?.['sale-sync-organisation'] ?? [];

        const organisations = items.map((item: any) => {
            try {
                return item.data ? JSON.parse(item.data) : { id: String(item.SK).replace('META#', '') };
            } catch {
                return { id: String(item.SK).replace('META#', '') };
            }
        });

        return organisations;
    }
}
