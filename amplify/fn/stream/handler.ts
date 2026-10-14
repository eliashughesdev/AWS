import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda'
import { unmarshall } from '@aws-sdk/util-dynamodb'

// What a log may say about a change: never a row's values. The streamed tables hold merchant
// API keys, card rows and customers' details, and CloudWatch keeps whatever is logged. The
// streams are KEYS_ONLY (backend.ts), so a record carries no row anyway.
export const describeRecord = (record: DynamoDBRecord) => ({
  eventName: record.eventName,
  table: record.eventSourceARN?.match(/:table\/([^/]+)/)?.[1],
  keys: record.dynamodb?.Keys ? unmarshall(record.dynamodb.Keys as any) : undefined,
})

// Nothing consumes the changes yet. The handler must return: an invocation that fails or never
// ends is retried with the same records until they expire, 24 hours later.
export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    console.log('Stream record:', JSON.stringify(describeRecord(record)))
  }
}
