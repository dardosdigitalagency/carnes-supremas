const { createServer } = require('./lib/http-server.cjs');

const hosted = Boolean(process.env.CMS_PUBLIC_ORIGIN) || process.argv.includes('--hosted') || process.env.NODE_ENV === 'production';
const server = createServer({ hosted });
server.listen(Number(process.env.PORT || 3000), hosted ? '0.0.0.0' : '127.0.0.1');
