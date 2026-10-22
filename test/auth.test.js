const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('node:http');
const { once } = require('node:events');
const authRoutes = require('../server/routes/auth');

test('GET /api/auth/me requires a valid session', async t => {
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Not authenticated' });
});
