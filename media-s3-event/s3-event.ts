import { S3Event, S3Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);
const s3Client = new S3Client({});
const TABLE_NAME = process.env.TABLE_NAME!;
// NOTE: Bucket name is extracted from S3 event record, not env var
// This avoids circular dependency in CloudFormation

/**
 * S3 Event Handler
 *
 * Triggered when a file is uploaded to S3.
 * Promotes the media record from the PENDING#MEDIA partition to MEDIA
 * once the upload completes.
 *
 * S3 Key format: cdn/{workspace_id}/{media_id}/{filename}
 */
export const lambdaHandler: S3Handler = async (event: S3Event): Promise<void> => {
    console.log('S3 Event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            await processRecord(record);
        } catch (error) {
            console.error('Error processing record:', error);
            // Don't throw - process remaining records
        }
    }
};

async function processRecord(record: S3Event['Records'][0]): Promise<void> {
    const bucketName = record.s3.bucket.name;  // Get from event, not env var
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const eventName = record.eventName;

    console.log(`Processing ${eventName} for bucket: ${bucketName}, key: ${s3Key}`);

    // Parse S3 key: cdn/{workspace_id}/{media_id}/{filename}
    const parts = s3Key.split('/');
    if (parts.length < 4 || parts[0] !== 'cdn') {
        console.log('Skipping - not a media upload path:', s3Key);
        return;
    }

    const workspaceId = parts[1];
    const mediaId = parts[2];
    const fileName = parts.slice(3).join('/'); // Handle filenames with slashes

    console.log(`Parsed: workspace=${workspaceId}, media=${mediaId}, file=${fileName}`);

    // 1. Fetch the existing pending item
    const existingItem = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
            PK: `WS#${workspaceId}#PENDING#MEDIA`,
            SK: `MEDIA#${mediaId}`,
        },
    }));

    if (!existingItem.Item) {
        console.log(`Media ${mediaId} not found in pending state - skipping`);
        return;
    }

    // 2. Get actual file size and metadata from S3
    const headResponse = await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
    }));

    const actualSize = headResponse.ContentLength || 0;
    const contentType = headResponse.ContentType || 'application/octet-stream';

    console.log(`File info: size=${actualSize}, contentType=${contentType}`);

    // Extract image dimensions if it's an image (from metadata if available)
    const metadata: Record<string, any> = {};

    // Check if it's an image and we have dimensions in custom metadata
    if (contentType.startsWith('image/')) {
        if (headResponse.Metadata?.width) {
            metadata.width = parseInt(headResponse.Metadata.width, 10);
        }
        if (headResponse.Metadata?.height) {
            metadata.height = parseInt(headResponse.Metadata.height, 10);
        }
    }

    // 3. Build the new item: copy existing fields, override with confirmed values,
    //    change PK, remove TTL
    const { TTL, ...itemWithoutTTL } = existingItem.Item as Record<string, any>;

    const data = {
        ...itemWithoutTTL?.data,
        status: 'ready',
        size: actualSize,
        mime_type: contentType,
        updated_at: new Date().toISOString(),
    };

    const newItem = {
        ...itemWithoutTTL,
        data,
        PK: `WS#${workspaceId}#MEDIA`,
        SK: `MEDIA#${mediaId}`,
        GSI1SK: `MEDIA#${fileName}`,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    // 4. Transact: put new item + delete old pending item atomically
    await docClient.send(new TransactWriteCommand({
        TransactItems: [
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: newItem,
                    ConditionExpression: 'attribute_not_exists(PK)',
                },
            },
            {
                Delete: {
                    TableName: TABLE_NAME,
                    Key: {
                        PK: `WS#${workspaceId}#PENDING#MEDIA`,
                        SK: `MEDIA#${mediaId}`,
                    },
                    ConditionExpression: 'attribute_exists(PK)',
                },
            },
        ],
    }));

    console.log(`✓ Media ${mediaId} promoted from PENDING#MEDIA to MEDIA`);
}