import {DynamoDBDocument} from '@aws-sdk/lib-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
export const sessionStore = DynamoDBDocument.from(new DynamoDBClient({region: process.env.DD_REGION, endpoint: process.env.DD_ENDPOINT}));
export const sessionTable = () => `classifySessionStore.${process.env.DOMAIN}`;
