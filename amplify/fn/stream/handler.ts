import type { DynamoDBStreamHandler } from 'aws-lambda'
import { unmarshall } from '@aws-sdk/util-dynamodb'

const resources = {
  v1UserKeysTable: (record: any) => new Promise(resolve => {
    if (record.eventName === 'REMOVE') {
      const old = unmarshall(record.dynamodb.OldImage)
      // todo do something with stream
    }
  })
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    console.log(JSON.stringify(record))
    for (const resourceName of Object.keys(resources)) {
      if (record.eventSourceARN?.includes(`/${resourceName}/`)) {
        // @ts-ignore
        await resources[resourceName](record)
      }
    }
  }
}
