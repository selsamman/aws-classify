// Serverless v3/v4 file resolver. Loaded only by the authenticated functions include.
const {validatePublicSuffix} = require('aws-classify-common');
module.exports = async ({resolveVariable}) => {
    const config = await resolveVariable('self:custom.awsClassify, null');
    if (!config || !config.authorizer || typeof config.authorizer.name !== 'string' || !config.authorizer.name.trim())
        throw new Error('awsClassify authentication requires an authorizer object with a nonempty name');
    const definitions = await resolveVariable('self:provider.httpApi.authorizers, null');
    if (!definitions || !Object.prototype.hasOwnProperty.call(definitions, config.authorizer.name))
        throw new Error('awsClassify authorizer must be defined in provider.httpApi.authorizers');
    const scopes = config.authorizer.scopes;
    if (scopes !== undefined && (!Array.isArray(scopes) || !scopes.every(scope => typeof scope === 'string' && scope.length && !/\s/.test(scope))))
        throw new Error('awsClassify authorizer scopes must be an array of nonempty scope names');
    const publicSuffix = validatePublicSuffix(config.publicSuffix);
    const logging = await resolveVariable('self:provider.logs.websocket, null');
    if (logging && (logging === true || logging.fullExecutionData !== false))
        throw new Error('Authenticated WebSocket logging requires fullExecutionData: false to protect connection credentials');
    return {authorizer: config.authorizer, publicSuffix};
};
