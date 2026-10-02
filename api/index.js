// Pre-require mongodb internals that @vercel/ncc fails to trace (mongodb 6.20+ resource_management)
try { require('mongodb/lib/resource_management'); } catch (_) {}
try { require('mongodb/lib/cursor/abstract_cursor'); } catch (_) {}

const app = require('../server');

module.exports = app;
