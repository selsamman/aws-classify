module.exports = async () => {
    console.log('Starting Serverless Testing Against AWS');
    console.log('Warning: You must deploy as needed:');
    console.log('> cd ../server');
    console.log('> sls deploy --verbose --stage dev');
    console.log('Note the url for WebsiteURL: ');
    console.log('set environment variable WebSiteURL=<url captured above>');
    if (!process.env.WebsiteURL)
        throw new Error ('WebsiteURL environment variable not set');
    process.env.__API__ = `${process.env.WebsiteURL}/api/dispatch`;
};
