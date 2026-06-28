import { S3Event, S3Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const dbClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const TABLE_NAME = process.env.TABLE_NAME!;
// NOTE: Bucket name is extracted from S3 event record, not env var
// This avoids circular dependency in CloudFormation

/**
 * S3 Event Handler
 * 
 * Triggered when a file is uploaded to S3.
 * Updates the media record status from 'pending' to 'ready'.
 * 
 * S3 Key format: workspaces/{workspace_id}/{media_id}/{filename}
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

    // Parse S3 key: workspaces/{workspace_id}/{media_id}/{filename}
    const parts = s3Key.split('/');
    if (parts.length < 4 || parts[0] !== 'workspaces') {
        console.log('Skipping - not a media upload path:', s3Key);
        return;
    }

    const organisationId = parts[1];
    const mediaId = parts[2];
    const fileName = parts.slice(3).join('/'); // Handle filenames with slashes

    console.log(`Parsed: organisation=${organisationId}, media=${mediaId}, file=${fileName}`);

    // Get actual file size and metadata from S3
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

    // Update DynamoDB record
    const updateExpression = [
        '#status = :status',
        '#size = :size',
        'mime_type = :mimeType',
        'updated_at = :now',
    ];
    
    const expressionAttributeNames: Record<string, string> = {
        '#status': 'status',
        '#size': 'size',
    };
    
    const expressionAttributeValues: Record<string, any> = {
        ':status': 'ready',
        ':size': actualSize,
        ':mimeType': contentType,
        ':now': new Date().toISOString(),
    };

    // Add metadata if we have any
    if (Object.keys(metadata).length > 0) {
        updateExpression.push('metadata = :metadata');
        expressionAttributeValues[':metadata'] = metadata;
    }

    // Add pending status check value
    expressionAttributeValues[':pendingStatus'] = 'pending';

    try {
        await dbClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                pk: `WS#${organisationId}`,
                sk: `MEDIA#${mediaId}`,
            },
            UpdateExpression: `SET ${updateExpression.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            // Only update if the record exists and is pending
            ConditionExpression: 'attribute_exists(pk) AND #status = :pendingStatus',
        }));

        console.log(`✓ Media ${mediaId} status updated to 'ready'`);
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            console.log(`Media ${mediaId} not found or not in pending status - skipping`);
        } else {
            throw error;
        }
    }
}