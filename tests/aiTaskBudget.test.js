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
      if (update?.$inc?.tokensUsed) {
        doc.tokensUsed = (doc.tokensUsed || 0) + update.$inc.tokensUsed;
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

  it('9. Plan Token Limit: Blocks user when daily tokens are exhausted', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const company = {
      _id: 'company-token-test',
      aiDailyTokenLimit: 20000,
      aiDailyCallLimit: 25,
      aiExtraTokens: 0,
    };
    mockAiUsage.store.set(`company-token-test:user-tok-01:${today}:task_agent`, {
      company: 'company-token-test',
      user: 'user-tok-01',
      date: today,
      feature: 'task_agent',
      count: 10,
      tokensUsed: 20050, // Exceeded 20,000 tokens
    });

    const req = {
      user: {
        _id: 'user-tok-01',
        company,
        companyRole: 'employee',
      },
      body: { message: 'create a meeting tomorrow' },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Turn must be blocked when token limit is exceeded');
    assert.equal(res.statusCode, 429, 'HTTP 429 returned');
    assert.equal(res.body.code, 'AI_TOKEN_LIMIT_REACHED');
  });

  it('10. Extra Top-Up Tokens: Allows exceeding base plan tokens if company has extra top-up tokens', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const company = {
      _id: 'company-topup-test',
      aiDailyTokenLimit: 20000,
      aiDailyCallLimit: 50,
      aiExtraTokens: 10000, // Total allowed = 30,000 tokens
    };
    mockAiUsage.store.set(`company-topup-test:user-tok-02:${today}:task_agent`, {
      company: 'company-topup-test',
      user: 'user-tok-02',
      date: today,
      feature: 'task_agent',
      count: 15,
      tokensUsed: 22000, // Above 20,000 but under 30,000!
    });

    const req = {
      user: {
        _id: 'user-tok-02',
        company,
        companyRole: 'employee',
      },
      body: { message: 'create project task' },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'Turn must be permitted due to extra top-up token buffer');
    assert.equal(res.statusCode, 200);
  });

  it('11. Deterministic Chips & Action turns bypass token exhaustion', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const company = {
      _id: 'company-chips-test',
      aiDailyTokenLimit: 20000,
      aiDailyCallLimit: 25,
      aiExtraTokens: 0,
    };
    mockAiUsage.store.set(`company-chips-test:user-tok-03:${today}:task_agent`, {
      company: 'company-chips-test',
      user: 'user-tok-03',
      date: today,
      feature: 'task_agent',
      count: 30,
      tokensUsed: 25000, // Completely exhausted
    });

    const deterministicMessages = ['skip', 'cancel', 'Create task'];
    for (const msg of deterministicMessages) {
      const req = {
        user: {
          _id: 'user-tok-03',
          company,
          companyRole: 'employee',
        },
        body: { message: msg },
        _deps: { AiUsage: mockAiUsage },
      };
      const res = createMockRes();
      let nextCalled = false;

      await aiTaskBudget(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, `Deterministic message '${msg}' must not be blocked by token limits`);
    }
  });

  it('12. consumeTaskBudget atomically increments count and tokensUsed', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const req = {
      user: {
        _id: 'user-tok-04',
        company: 'company-consume-test',
        companyRole: 'employee',
      },
      _deps: { AiUsage: mockAiUsage },
    };

    await aiTaskBudget.consumeTaskBudget(req, 820);
    const stored = mockAiUsage.store.get(`company-consume-test:user-tok-04:${today}:task_agent`);
    assert.ok(stored, 'Record created in usage store');
    assert.equal(stored.count, 1, 'Count incremented to 1');
    assert.equal(stored.tokensUsed, 820, 'Tokens used recorded as 820');
  });

  it('13. BYOK Mode (User API): Bypasses platform budget and marks isClientApiKey true', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const company = {
      _id: 'company-byok-test',
      aiApiKeySource: 'client',
      customGroqApiKey: 'gsk_custom_user_key_123',
      aiDailyTokenLimit: 20000,
      aiDailyCallLimit: 25,
      aiExtraTokens: 0,
    };
    // Pretend tokens are already maxed out
    mockAiUsage.store.set(`company-byok-test:user-byok-01:${today}:task_agent`, {
      company: 'company-byok-test',
      user: 'user-byok-01',
      date: today,
      feature: 'task_agent',
      count: 999,
      tokensUsed: 999999,
    });

    const req = {
      user: {
        _id: 'user-byok-01',
        company,
        companyRole: 'admin',
      },
      body: { message: 'create meeting with client' },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'User API plan must bypass platform quota');
    assert.equal(req.aiTaskUsage?.isClientApiKey, true, 'Flagged as client API key');
  });

  it('14. GroqKeyManager: Client API key is strictly isolated and NEVER touches platform keys', async () => {
    const { executeWithGroqFallback } = require('../services/ai/groqKeyManager');

    let keyUsed = null;
    const testOp = async (apiKey) => {
      keyUsed = apiKey;
      return 'ok';
    };

    // 1. Valid custom key -> strictly uses that key
    const res = await executeWithGroqFallback(testOp, { customApiKey: 'gsk_client_custom_999', strictCustomOnly: true });
    assert.equal(res, 'ok');
    assert.equal(keyUsed, 'gsk_client_custom_999', 'Must execute strictly with client custom key');

    // 2. Missing custom key when strictCustomOnly -> must throw BYOK_KEY_MISSING without calling platform keys
    await assert.rejects(
      async () => {
        await executeWithGroqFallback(testOp, { customApiKey: null, strictCustomOnly: true });
      },
      (err) => {
        assert.equal(err.code, 'BYOK_KEY_MISSING');
        return true;
      },
      'Must strictly reject when custom key is missing in BYOK mode'
    );
  });

  it('15. BYOK Mode: Blocks regular employee when their allocated tokens are exhausted', async () => {
    const today = aiTaskBudget.getTodayIstDate();
    const company = {
      _id: 'company-byok-test-2',
      aiApiKeySource: 'client',
      customGroqApiKey: 'gsk_custom_user_key_456',
      byokDefaultEmployeeDailyTokens: 5000,
      byokDefaultEmployeeDailyCalls: 20,
    };
    mockAiUsage.store.set(`company-byok-test-2:emp-limited-01:${today}:task_agent`, {
      company: 'company-byok-test-2',
      user: 'emp-limited-01',
      date: today,
      feature: 'task_agent',
      count: 10,
      tokensUsed: 5200, // Exceeded 5000
    });

    const req = {
      user: {
        _id: 'emp-limited-01',
        company,
        companyRole: 'employee',
        aiConfig: { enabled: true, customDailyTokenLimit: 5000 },
      },
      body: { message: 'create meeting with client' },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Employee must be blocked when allocated quota is reached');
    assert.equal(res.statusCode, 429, 'Returns HTTP 429');
    assert.equal(res.body?.code, 'EMPLOYEE_TOKEN_LIMIT_REACHED');
  });

  it('16. BYOK Mode: Returns 403 when company admin has disabled AI access for employee', async () => {
    const company = {
      _id: 'company-byok-test-3',
      aiApiKeySource: 'client',
      customGroqApiKey: 'gsk_custom_user_key_789',
    };
    const req = {
      user: {
        _id: 'emp-disabled-01',
        company,
        companyRole: 'employee',
        aiConfig: { enabled: false },
      },
      body: { message: 'parse new project requirement note' },
      _deps: { AiUsage: mockAiUsage },
    };
    const res = createMockRes();
    let nextCalled = false;

    await aiTaskBudget(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Disabled employee must be blocked');
    assert.equal(res.statusCode, 403, 'Returns HTTP 403');
    assert.equal(res.body?.code, 'AI_ACCESS_DISABLED_BY_ADMIN');
  });
});
