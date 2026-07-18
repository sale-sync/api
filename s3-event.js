"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// s3-event.ts
var s3_event_exports = {};
__export(s3_event_exports, {
  lambdaHandler: () => lambdaHandler
});
module.exports = __toCommonJS(s3_event_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_s3 = require("@aws-sdk/client-s3");
var dbClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dbClient);
var s3Client = new import_client_s3.S3Client({});
var TABLE_NAME = process.env.TABLE_NAME;
var lambdaHandler = async (event) => {
  console.log("S3 Event received:", JSON.stringify(event, null, 2));
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }
};
async function processRecord(record) {
  const bucketName = record.s3.bucket.name;
  const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  const eventName = record.eventName;

  console.log(`Processing ${eventName} for bucket: ${bucketName}, key: ${s3Key}`);

  const parts = s3Key.split("/");
  if (parts.length < 4 || parts[0] !== "cdn") {
    console.log("Skipping - not a media upload path:", s3Key);
    return;
  }

  const workspaceId = parts[1];
  const mediaId = parts[2];
  const fileName = parts.slice(3).join("/")

  console.log(`Parsed: workspace=${workspaceId}, media=${mediaId}`);

  // 1. Fetch the existing pending item
  const existingItem = await docClient.send(new import_lib_dynamodb.GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `WS#${workspaceId}#PENDING#MEDIA`,
      SK: `MEDIA#${mediaId}`
    }
  }));

  if (!existingItem.Item) {
    console.log(`Media ${mediaId} not found in pending state - skipping`);
    return;
  }

  // 2. Get S3 metadata
  const headResponse = await s3Client.send(new import_client_s3.HeadObjectCommand({
    Bucket: bucketName,
    Key: s3Key
  }));

  const actualSize = headResponse.ContentLength || 0;
  const contentType = headResponse.ContentType || "application/octet-stream";

  console.log(`File info: size=${actualSize}, contentType=${contentType}`);

  const metadata = {};
  if (contentType.startsWith("image/")) {
    if (headResponse.Metadata?.width) metadata.width = parseInt(headResponse.Metadata.width, 10);
    if (headResponse.Metadata?.height) metadata.height = parseInt(headResponse.Metadata.height, 10);
  }

  // 3. Build the new item: copy existing fields, override with confirmed values,
  //    change PK, remove TTL
  const { TTL, ...itemWithoutTTL } = existingItem.Item;

  const data = {
    ...itemWithoutTTL?.data,
    status: "ready",
    size: actualSize,
    mime_type: contentType,
    updated_at: new Date().toISOString(),
  }

  const newItem = {
    ...itemWithoutTTL,
    data,
    PK: `WS#${workspaceId}#MEDIA`,
    SK: `MEDIA#${mediaId}`,
    GSI1SK: `MEDIA#${fileName}`,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {})
  };

  // 4. Transact: put new item + delete old pending item atomically
  await docClient.send(new import_lib_dynamodb.TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: newItem,
          ConditionExpression: "attribute_not_exists(PK)"
        }
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: {
            PK: `WS#${workspaceId}#PENDING#MEDIA`,
            SK: `MEDIA#${mediaId}`
          },
          ConditionExpression: "attribute_exists(PK)"
        }
      }
    ]
  }));

  console.log(`✓ Media ${mediaId} promoted from PENDING#MEDIA to MEDIA`);
}

// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  lambdaHandler
});
