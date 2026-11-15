// Serverless file resolver; cloud/serverless.yml sits one level below the root package.
module.exports = async ({resolveVariable}) => {
    const directory = await resolveVariable('file(../package.json):awsClassify.spaDirectory');
    if (typeof directory !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(directory) || directory.split('/')[0] === 'api')
        throw new Error('awsClassify.spaDirectory must be a relative directory such as "app", outside api/.');
    const uri = '/' + directory;
    return {functionCode: `function handler(event) {
    var request = event.request;
    if (request.uri === ${JSON.stringify(uri)} || request.uri === ${JSON.stringify(uri + '/')}) {
        request.uri = ${JSON.stringify(uri + '/index.html')};
    }
    return request;
}`};
};
