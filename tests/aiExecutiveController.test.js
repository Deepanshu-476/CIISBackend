const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { getExecutiveInsights } = require('../controllers/aiExecutiveController');
const aiExecutiveNarrativeService = require('../services/aiExecutiveNarrativeService');

async function createTestServer(t, { mockServiceResponse = null, onCall = null } = {}) {
  const app = express();
  app.use(express.json());

  // Intercept getExecutiveRadar in the service
  const originalGetRadar = aiExecutiveNarrativeService.getExecutiveRadar;
  aiExecutiveNarrativeService.getExecutiveRadar = async (params) => {
    if (onCall) onCall(params);
    if (mockServiceResponse) {
      if (typeof mockServiceResponse === 'function') {
        return mockServiceResponse(params);
      }
      return mockServiceResponse;
    }
    return {
      metrics: { overview: { cohortSize: 100, completed: 90 } },
      narrative: {
        headline: 'Executive summary for 30d',
        keyFindings: [],
        criticalAlerts: [],
        workshopProposals: [],
        next30DaysPlan: [],
      },
      narrativeAvailable: true,
      meta: {
        range: params.range || '30d',
        department: params.department || 'all',
        generatedAt: new Date().toISOString(),
        cached: false,
        durationMs: 50,
      },
    };
  };

  t.after(() => {
    aiExecutiveNarrativeService.getExecutiveRadar = originalGetRadar;
  });

  // Simulated protect middleware for tests
  const testProtect = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    // Token format: Bearer <role>
    const role = auth.split(' ')[1];
    req.user = {
      _id: '507f1f77bcf86cd799439011',
      name: 'Test User',
      company: '507f1f77bcf86cd799439010',
      companyCode: 'TESTCOMP',
      companyRole: role,
      role: role,
      isCompanyOwner: role.toLowerCase() === 'owner',
    };
    next();
  };

  // Mount route identically to routes/aiRoutes.js
  app.get('/api/ai/executive-insights', testProtect, restrictTo('Owner', 'Admin'), getExecutiveInsights);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  const port = server.address().port;
  const request = (queryStr = '', role = null) => {
    const headers = {};
    if (role) {
      headers.authorization = `Bearer ${role}`;
    }
    return fetch(`http://127.0.0.1:${port}/api/ai/executive-insights${queryStr}`, { headers });
  };

  return { request };
}

test('Step 5 - 401 when no token is provided', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('');
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('Step 5 - 403 when Employee attempts access', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('', 'Employee');
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('Step 5 - 403 when Manager attempts access', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('', 'Manager');
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('Step 5 - 200 when Owner accesses endpoint', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('', 'Owner');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.metrics);
  assert.ok(body.data.narrative);
  assert.equal(body.data.meta.narrativeAvailable, true);
});

test('Step 5 - 200 when Admin accesses endpoint', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('?range=7d', 'Admin');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.meta.range, '7d');
});

test('Step 5 - 400 when invalid range is passed', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('?range=14d', 'Owner');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /range.*(?:7d|30d|90d)/i);
});

test('Step 5 - refresh=true is parsed and passed to the service', async (t) => {
  let passedRefresh = null;
  const { request } = await createTestServer(t, {
    onCall: (params) => {
      passedRefresh = params.refresh;
    },
  });

  const res = await request('?refresh=true', 'Owner');
  assert.equal(res.status, 200);
  assert.equal(passedRefresh, true);

  const resFalse = await request('?refresh=false', 'Owner');
  assert.equal(resFalse.status, 200);
  assert.equal(passedRefresh, false);
});

test('Step 5 - narrative fallback still returns 200 with narrativeAvailable: false', async (t) => {
  const fallbackResponse = {
    metrics: { overview: { cohortSize: 200, completed: 180 } },
    narrative: null,
    narrativeAvailable: false,
    reason: 'LLM rate limit exceeded (429)',
    meta: {
      range: '30d',
      department: 'all',
      generatedAt: new Date().toISOString(),
      cached: false,
      durationMs: 120,
    },
  };

  const { request } = await createTestServer(t, {
    mockServiceResponse: fallbackResponse,
  });

  const res = await request('', 'Owner');
  assert.equal(res.status, 200); // Must be 200, NEVER 5xx!
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.narrative, null);
  assert.equal(body.data.meta.narrativeAvailable, false);
  assert.equal(body.data.meta.narrativeReason, 'LLM rate limit exceeded (429)');
});

test('Step 5 - no response contains unmapped internal aliases or leaked employee identities', async (t) => {
  const { request } = await createTestServer(t);
  const res = await request('', 'Owner');
  assert.equal(res.status, 200);
  const text = await res.text();
  // Ensure no unmapped internal alias tokens like Worker-O1 or Agent-1 remain in returned mock data
  assert.equal(text.includes('Worker-O'), false);
  assert.equal(text.includes('Worker-U'), false);
});

// -------------------------------------------------------------
// REAL MIDDLEWARE CHAIN TESTS (Real protect + Real restrictTo)
// Uses signed test JWTs and mocked User.findById
// -------------------------------------------------------------
async function createRealMiddlewareTestServer(t) {
  const app = express();
  app.use(express.json());

  const originalGetRadar = aiExecutiveNarrativeService.getExecutiveRadar;
  aiExecutiveNarrativeService.getExecutiveRadar = async (params) => ({
    metrics: { overview: { cohortSize: 100, completed: 90 } },
    narrative: {
      headline: 'Real middleware executive summary',
      keyFindings: [],
      criticalAlerts: [],
      workshopProposals: [],
      next30DaysPlan: [],
    },
    narrativeAvailable: true,
    meta: {
      range: params.range || '30d',
      department: params.department || 'all',
      generatedAt: new Date().toISOString(),
      cached: false,
      durationMs: 40,
    },
  });

  t.after(() => {
    aiExecutiveNarrativeService.getExecutiveRadar = originalGetRadar;
  });

  const User = require('../models/User');
  const origFindById = User.findById;

  const realCompanyDoc = {
    _id: '507f1f77bcf86cd799439010',
    companyName: 'Real Comp',
    companyCode: 'REALCOMP',
    isActive: true,
  };

  const mockUsers = {
    'user_owner': {
      _id: '507f1f77bcf86cd799439011',
      name: 'Real Owner',
      companyRole: 'Owner',
      isCompanyOwner: true,
      isActive: true,
      company: realCompanyDoc,
      companyCode: 'REALCOMP',
    },
    'user_admin': {
      _id: '507f1f77bcf86cd799439012',
      name: 'Real Admin',
      companyRole: 'Admin',
      role: 'Admin',
      isActive: true,
      company: realCompanyDoc,
      companyCode: 'REALCOMP',
    },
    'user_employee': {
      _id: '507f1f77bcf86cd799439013',
      name: 'Real Employee',
      companyRole: 'Employee',
      jobRole: 'Employee',
      isActive: true,
      company: realCompanyDoc,
      companyCode: 'REALCOMP',
    },
    'user_manager': {
      _id: '507f1f77bcf86cd799439014',
      name: 'Real Manager',
      companyRole: 'Manager',
      role: 'Manager',
      isActive: true,
      company: realCompanyDoc,
      companyCode: 'REALCOMP',
    },
  };

  User.findById = (id) => {
    const userDoc = mockUsers[String(id)] || null;
    const chain = {
      select: () => chain,
      populate: () => chain,
      lean: () => chain,
      then: (resolve) => resolve(userDoc),
      exec: async () => userDoc,
    };
    return chain;
  };

  t.after(() => {
    User.findById = origFindById;
  });

  // REAL protect and REAL restrictTo('Owner', 'Admin')
  app.get('/api/ai/executive-insights', protect, restrictTo('Owner', 'Admin'), getExecutiveInsights);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  const port = server.address().port;
  const request = (queryStr = '', token = null) => {
    const headers = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return fetch(`http://127.0.0.1:${port}/api/ai/executive-insights${queryStr}`, { headers });
  };

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'test_jwt_secret_step5_123';
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = secret;

  const makeToken = (id) => jwt.sign({ id }, secret, { expiresIn: '1h' });

  return { request, makeToken };
}

test('Step 5 (Real Middleware) - 401 when no token is passed', async (t) => {
  const { request } = await createRealMiddlewareTestServer(t);
  const res = await request('');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.message, /Not authorized to access this route - No token/);
});

test('Step 5 (Real Middleware) - 403 when Employee signs in with valid JWT', async (t) => {
  const { request, makeToken } = await createRealMiddlewareTestServer(t);
  const res = await request('', makeToken('user_employee'));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /You do not have permission to perform this action/);
});

test('Step 5 (Real Middleware) - 403 when Manager signs in with valid JWT', async (t) => {
  const { request, makeToken } = await createRealMiddlewareTestServer(t);
  const res = await request('', makeToken('user_manager'));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.error, /You do not have permission to perform this action/);
});

test('Step 5 (Real Middleware) - 200 when Owner signs in with valid JWT', async (t) => {
  const { request, makeToken } = await createRealMiddlewareTestServer(t);
  const res = await request('', makeToken('user_owner'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.narrative.headline, 'Real middleware executive summary');
});

test('Step 5 (Real Middleware) - 200 when Admin signs in with valid JWT', async (t) => {
  const { request, makeToken } = await createRealMiddlewareTestServer(t);
  const res = await request('', makeToken('user_admin'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.meta.narrativeAvailable, true);
});
