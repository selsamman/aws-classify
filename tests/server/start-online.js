module.exports = async () => {
    const api = process.env.TestAPIURL || (process.env.WebsiteURL && `${process.env.WebsiteURL.replace(/\/$/, '')}/api/dispatch`);
    if (!api) throw new Error('Set TestAPIURL to the fixture dispatch URL, or WebsiteURL to its https:// website URL');
    if (!['http:', 'https:'].includes(new URL(api).protocol)) throw new Error('The test endpoint must be an HTTP(S) URL');
    console.log(`Testing deployed fixture: ${api}`);
    process.env.__API__ = api;
};
