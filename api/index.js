// Keep MongoDB's resource-management helper in Vercel's traced serverless bundle.
require('mongodb/lib/resource_management');

const app = require('../server');

module.exports = app;
