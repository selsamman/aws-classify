// jsdom does not supply the browser encoders used by JOSE. Keep Node exports
// for CommonJS Jest; packed consumers separately check the browser ESM bundle.
const {TextEncoder, TextDecoder} = require('node:util');
global.TextEncoder ||= TextEncoder;
global.TextDecoder ||= TextDecoder;
