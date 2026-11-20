/**
 * tests/projectRouteAuth.test.js
 *
 * Real Express route test for project task endpoint:
 * Proves that POST /api/projects/:id/tasks is an authentic registered route
 * guarded by authentication middleware (returns 401, NOT 404).
 */

process.env.NODE_ENV = 'test';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const { FORM_REGISTRY } = require('../services/ai/formRegistry');
const projectRoutes = require('../HR-CDS/routes/projectRoutes');

describe('Project Route Auth & Registration Suite (Part 2)', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectRoutes);

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
    }
  });

  it('2. FORM_REGISTRY.task_project endpoint resolves to route mounted under /api/projects', () => {
    const config = FORM_REGISTRY.task_project;
    assert.equal(config.endpoint, '/projects/:id/tasks');

    const sampleId = '60d5ec49f1b2c8b1f8e4e1a1';
    const resolvedPath = config.buildPayload({ projectId: sampleId }).endpoint;
    assert.equal(resolvedPath, `/projects/${sampleId}/tasks`);
  });

  it('3. Unauthenticated POST to /api/projects/:id/tasks returns 401 Unauthorized (never 404)', async () => {
    const randomObjectId = new mongoose.Types.ObjectId().toString();
    const targetUrl = `${baseUrl}/api/projects/${randomObjectId}/tasks`;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Unauthenticated Task Test',
      }),
    });

    // Proves the route exists (not 404) and authentication guard is active
    assert.equal(res.status, 401, `Expected 401 Unauthorized, received ${res.status}`);
  });

  it('4. Unregistered route returns 404, proving 401 is specific to protected route', async () => {
    const randomObjectId = new mongoose.Types.ObjectId().toString();
    const fakeUrl = `${baseUrl}/api/projects/${randomObjectId}/nonexistent-xyz-action`;

    const res = await fetch(fakeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 404, `Expected 404 Not Found for nonexistent route, received ${res.status}`);
  });
});
