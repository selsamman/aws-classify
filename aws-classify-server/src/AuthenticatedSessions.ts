import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {RequestContext, SocketAuthorization} from 'aws-classify-common';
import {sessionStore as db, sessionTable} from './SessionStore';
const now = () => Math.floor(Date.now() / 1000);
export function sessionOwner(context: RequestContext): string {
    if (context.dispatch === 'public') return 'public';
    if (!context.identity) {
        if (context.offline) return 'offline-unvalidated';
        throw new Error('Validated identity required');
    }
    return JSON.stringify([context.identity.issuer, context.identity.subject]);
}
export async function ownedSession(sessionId: string, owner: string, minutes: number): Promise<any> {
    if (sessionId) {
        const result = await db.get({TableName: sessionTable(), Key: {sessionId}, ConsistentRead: true});
        if (!result.Item || !(result.Item.expires > now()) || result.Item.authOwner !== owner) throw new Error('Session is not owned by this caller or has expired');
        return result.Item;
    }
    const item = {sessionId: randomUUID(), authOwner: owner, updated: Date.now(), expires: now() + Math.floor(minutes * 60)};
    await db.put({TableName: sessionTable(), Item: item, ConditionExpression: 'attribute_not_exists(sessionId)'});
    return item;
}
export async function issueConnectionCredential(session: any, seconds: number, url: string): Promise<SocketAuthorization> {
    if (session.authOwner === 'public') throw new Error('Public sessions cannot attach sockets');
    const credential = `ac1.${Buffer.from(session.sessionId).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
    const expiresAt = Math.min(now() + seconds, session.expires);
    await db.update({TableName: sessionTable(), Key: {sessionId: session.sessionId},
        UpdateExpression: 'SET credentialHash = :hash, credentialExpires = :expiry',
        ConditionExpression: 'authOwner = :owner AND expires > :now',
        ExpressionAttributeValues: {':hash': createHash('sha256').update(credential).digest('hex'), ':expiry': expiresAt, ':owner': session.authOwner, ':now': now()}});
    return {url, credential, expiresAt};
}
export async function attachAuthenticatedSocket(credential: string, connectionId: string): Promise<void> {
    if (!/^ac1\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{43}$/.test(credential) || !connectionId) throw new Error('Invalid connection credential');
    const sessionId = Buffer.from(credential.split('.')[1], 'base64url').toString();
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid connection credential');
    const result = await db.get({TableName: sessionTable(), Key: {sessionId}, ConsistentRead: true});
    const session = result.Item;
    if (!session?.authOwner || session.authOwner === 'public') throw new Error('Invalid connection credential');
    // Consumption and connection recording succeed together. A replay or concurrent loser fails the condition.
    await db.transactWrite({TransactItems: [
        {Update: {TableName: sessionTable(), Key: {sessionId},
            UpdateExpression: 'SET connectionId = :connection REMOVE credentialHash, credentialExpires',
            ConditionExpression: 'authOwner = :owner AND credentialHash = :hash AND credentialExpires > :now AND expires > :now',
            ExpressionAttributeValues: {':connection': connectionId, ':owner': session.authOwner, ':hash': createHash('sha256').update(credential).digest('hex'), ':now': now()}}},
        {Put: {TableName: sessionTable(), Item: {sessionId: `connection#${connectionId}`, targetSessionId: sessionId, expires: session.expires}, ConditionExpression: 'attribute_not_exists(sessionId)'}}
    ]});
}
export async function detachAuthenticatedSocket(connectionId: string): Promise<void> {
    const key = {sessionId: `connection#${connectionId}`};
    const mapping = (await db.get({TableName: sessionTable(), Key: key, ConsistentRead: true})).Item;
    if (!mapping) return;
    try {
        await db.update({TableName: sessionTable(), Key: {sessionId: mapping.targetSessionId}, UpdateExpression: 'REMOVE connectionId', ConditionExpression: 'connectionId = :connection', ExpressionAttributeValues: {':connection': connectionId}});
    } catch (error: any) { if (error.name !== 'ConditionalCheckFailedException') throw error; }
    await db.delete({TableName: sessionTable(), Key: key});
}
