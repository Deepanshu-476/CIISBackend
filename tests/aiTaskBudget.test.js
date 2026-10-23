const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const aiTaskBudget = require('../middleware/aiTaskBudget');

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

// In-memory mock store that mimics MongoDB findOneAndUpdate with $inc and upsert
const createMockAiUsageModel = () => {
  const store = new Map();

  return {
    store,
    findOne: async (filter) => {
      if (!filter.company) {
        throw new Error('Tenant isolation violated: filter.company is required');
      }
      const companyKey = typeof filter.company === 'object' && filter.company?._id
        ? String(filter.company._id)
        : String(filter.company);
      const userKey = typeof filter.user === 'object' && filter.user?._id
        ? String(filter.user._id)
        : String(filter.user);
      const key = `${companyKey}:${userKey}:${filter.date}:${filter.feature}`;
      const doc = store.get(key);
      return doc ? { ...doc } : null;
    },
    findOneAndUpdate: async (filter, update, options) => {
      // Ensure company is always present in query (multi-tenant rule)
      if (!filter.company) {
        throw new Error('Tenant isolation violated: filter.company is required');
      }

      const companyKey = typeof filter.company === 'object' && filter.company?._id
        ? String(filter.company._id)
        : String(filter.company);
      const userKey = typeof filter.user === 'object' && filter.user?._id
        ? String(filter.user._id)
        : String(filter.user);
      const key = `${companyKey}:${userKey}:${filter.date}:${filter.feature}`;

      let doc = store.get(key);
      if (!doc) {
        if (options?.upsert) {
          doc = {
            company: filter.company,
            user: filter.user,
            date: filter.date,
            feature: filter.feature,
            count: 0,
          };
          store.set(key, doc);
        } else {
          return null;
        }
      }

      if (update?.$inc?.count) {
        doc.count += update.$inc.count;
      }

      return { ...doc };
    },
  };
};

describe('aiTaskBudget middleware tests', () => {
  let mockAiUsage;

  beforeEach(() => {
    mockAiUsage = createMockAiUsageModel();
    process.env.AI_TASK_DAILY_LIMIT = '40';
    process.env.AI_TASK_DAILY_LIMIT_ADMIN = '150';
  });

  it('1. under limit -> calls next() and does not return 429', async () => {
    const req = {
      user: {
        _id: 'user-001',
        company: 'company-alpha',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'next() must be called when under limit');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, null);

    // Call consumeTaskBudget as happens on an LLM turn
    await aiTaskBudget.consumeTaskBudget(req);

    // Verify record in mock store
    const today = aiTaskBudget.getTodayIstDate();
    const stored = mockAiUsage.store.get(`company-alpha:user-001:${today}:task_agent`);
    assert.ok(stored);
    assert.equal(stored.count, 1);
  });

  it('2. at limit -> count = 39 calls next() and is allowed, consume increments to 40', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    // Pre-populate count at 39
    mockAiUsage.store.set(`company-alpha:user-002:${today}:task_agent`, {
      company: 'company-alpha',
      user: 'user-002',
      date: today,
      feature: 'task_agent',
      count: 39,
    });

    const req = {
      user: {
        _id: 'user-002',
        company: 'company-alpha',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, '39th request must still be allowed under limit 40');
    assert.equal(res.statusCode, 200);

    await aiTaskBudget.consumeTaskBudget(req);
    const stored = mockAiUsage.store.get(`company-alpha:user-002:${today}:task_agent`);
    assert.equal(stored.count, 40);
  });

  it('3. exceeding limit -> count = 40 returns HTTP 429 with Hinglish message', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    // Pre-populate count at 40 (limit reached)
    mockAiUsage.store.set(`company-alpha:user-003:${today}:task_agent`, {
      company: 'company-alpha',
      user: 'user-003',
      date: today,
      feature: 'task_agent',
      count: 40,
    });

    const req = {
      user: {
        _id: 'user-003',
        company: 'company-alpha',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'next() must NOT be called when limit is reached');
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.success, false);
    assert.ok(
      res.body.message.includes('Aaj ka daily AI task budget exceed ho gaya hai') ||
      res.body.message.includes('koshish karein'),
      'Must return Hinglish message on exceeding limit'
    );
  });

  it('4. different company same user id isolation -> company B not affected by company A limit', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const sharedUserId = 'shared-user-007';

    // Company A user has reached limit
    mockAiUsage.store.set(`comp-A:${sharedUserId}:${today}:task_agent`, {
      company: 'comp-A',
      user: sharedUserId,
      date: today,
      feature: 'task_agent',
      count: 40,
    });

    // Request for Company A -> should be rejected (429)
    const reqA = {
      user: {
        _id: sharedUserId,
        company: 'comp-A',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const resA = createMockRes();
    let nextCalledA = false;
    await aiTaskBudget(reqA, resA, () => {
      nextCalledA = true;
    });
    assert.equal(nextCalledA, false);
    assert.equal(resA.statusCode, 429);

    // Request for Company B with the same user ID -> should be permitted (fresh count)
    const reqB = {
      user: {
        _id: sharedUserId,
        company: 'comp-B',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const resB = createMockRes();
    let nextCalledB = false;
    await aiTaskBudget(reqB, resB, () => {
      nextCalledB = true;
    });

    assert.equal(nextCalledB, true, 'Company B should have its own isolated budget');
    assert.equal(resB.statusCode, 200);

    await aiTaskBudget.consumeTaskBudget(reqB);
    const storedB = mockAiUsage.store.get(`comp-B:${sharedUserId}:${today}:task_agent`);
    assert.equal(storedB.count, 1, 'Company B count must be 1, isolated from Company A');
  });

  it('5. Owner/Admin higher limit -> allows requests up to 150', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    // Pre-populate count at 40 (normal employee would be blocked, but Owner has 150)
    mockAiUsage.store.set(`company-alpha:owner-01:${today}:task_agent`, {
      company: 'company-alpha',
      user: 'owner-01',
      date: today,
      feature: 'task_agent',
      count: 40,
    });

    const reqOwner = {
      user: {
        _id: 'owner-01',
        company: 'company-alpha',
        companyRole: 'Owner',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(reqOwner, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'Owner with 40 count should be allowed (limit 150)');
    assert.equal(res.statusCode, 200);
  });

  it('6. missing company -> returns HTTP 403', async () => {
    const req = {
      user: {
        _id: 'user-no-company',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
  });

  it('7. IST Date formatting conforms to YYYY-MM-DD', () => {
    const todayStr = aiTaskBudget.getTodayIstDate();
    assert.match(todayStr, /^\d{4}-\d{2}-\d{2}$/, 'Date format must strictly match YYYY-MM-DD');
  });

  it('8. non-LLM action/skip turns do not increment budget', async () => {
    const req = {
      user: {
        _id: 'user-action-01',
        company: 'company-alpha',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    // Because no LLM call happened, consumeTaskBudget was NOT called
    const today = aiTaskBudget.getTodayIstDate();
    const stored = mockAiUsage.store.get(`company-alpha:user-action-01:${today}:task_agent`);
    assert.equal(stored, undefined, 'No budget entry created for free turn');
  });
});
