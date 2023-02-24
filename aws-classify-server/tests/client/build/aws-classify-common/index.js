"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reqBody = exports.EndPointsLogging = void 0;
var EndPointsLogging_1 = require("./EndPointsLogging");
Object.defineProperty(exports, "EndPointsLogging", { enumerable: true, get: function () { return EndPointsLogging_1.EndPointsLogging; } });
const reqBody = () => { throw new Error('Request class not registered'); };
exports.reqBody = reqBody;
