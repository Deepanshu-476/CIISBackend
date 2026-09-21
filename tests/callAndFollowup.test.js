const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const callController = require('../controllers/callController');
const followupController = require('../controllers/followupController');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const Lead = require('../models/Lead');

test('Call flow: startCall, endCall with duration and status, and getAgentCalls', async () => {
  const agentId = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId();

  // Mock CallLog model methods
  let storedCall = null;
  const originalCreate = CallLog.create;
  const originalFindById = CallLog.findById;
  const originalFind = CallLog.find;

  CallLog.create = async (doc) => {
    storedCall = {
      _id: new mongoose.Types.ObjectId(),
      ...doc,
      startTime: doc.startTime || new Date(),
      save: async function () { return this; }
    };
    return storedCall;
  };

  CallLog.findById = (id) => ({
    populate: () => ({
      populate: () => Promise.resolve(storedCall),
      then: (resolve) => resolve(storedCall)
    }),
    then: (resolve) => resolve(storedCall)
  });

  CallLog.find = (query) => ({
    populate: () => ({
      populate: () => ({
        sort: () => Promise.resolve([storedCall])
      })
    })
  });

  try {
    // 1. startCall
    let startRes = {};
    const startReq = {
      body: { leadId: leadId.toString() },
      user: { _id: agentId }
    };
    await callController.startCall(startReq, {
      status: (code) => ({
        json: (data) => { startRes = { code, data }; }
      }),
      json: (data) => { startRes = { code: 200, data }; }
    });

    assert.equal(startRes.code, 201);
    assert.ok(storedCall);
    assert.equal(storedCall.lead.toString(), leadId.toString());
    assert.equal(storedCall.agent.toString(), agentId.toString());
    assert.ok(storedCall.startTime);

    // 2. endCall after simulated 15 seconds
    storedCall.startTime = new Date(Date.now() - 15000);
    let endRes = {};
    const endReq = {
      body: {
        callId: storedCall._id.toString(),
        status: "answered",
        notes: "Discussed course fees and scheduled callback."
      },
      user: { _id: agentId }
    };

    await callController.endCall(endReq, {
      json: (data) => { endRes = { code: 200, data }; },
      status: (code) => ({
        json: (data) => { endRes = { code, data }; }
      })
    });

    assert.equal(endRes.code, 200);
    assert.ok(storedCall.duration >= 14 && storedCall.duration <= 16, `Duration should be around 15s, got ${storedCall.duration}`);
    assert.equal(storedCall.status, "answered");
    assert.equal(storedCall.notes, "Discussed course fees and scheduled callback.");

    // 3. getAgentCalls
    let listRes = {};
    await callController.getAgentCalls({ user: { _id: agentId } }, {
      json: (data) => { listRes = { code: 200, data }; }
    });

    assert.equal(listRes.code, 200);
    assert.ok(Array.isArray(listRes.data));
    assert.equal(listRes.data.length, 1);
  } finally {
    CallLog.create = originalCreate;
    CallLog.findById = originalFindById;
    CallLog.find = originalFind;
  }
});

test('Call security: invalid lead format and cross-company lead are rejected', async () => {
  const agentId = new mongoose.Types.ObjectId();
  const companyA = new mongoose.Types.ObjectId();
  const companyB = new mongoose.Types.ObjectId();
  const foreignLeadId = new mongoose.Types.ObjectId();

  const originalLeadFindById = Lead.findById;
  Lead.findById = (id) => ({
    lean: async () => ({
      _id: foreignLeadId,
      company: companyB,
      assignedTo: new mongoose.Types.ObjectId()
    })
  });

  try {
    // Invalid lead ID format
    let invalidRes = {};
    await callController.startCall({
      body: { leadId: "not-an-id" },
      user: { _id: agentId, company: companyA }
    }, {
      status: (code) => ({ json: (data) => { invalidRes = { code, data }; } }),
      json: (data) => { invalidRes = { code: 200, data }; }
    });
    assert.equal(invalidRes.code, 400);

    // Cross-company lead
    let foreignRes = {};
    await callController.startCall({
      body: { leadId: foreignLeadId.toString() },
      user: { _id: agentId, company: companyA }
    }, {
      status: (code) => ({ json: (data) => { foreignRes = { code, data }; } }),
      json: (data) => { foreignRes = { code: 200, data }; }
    });
    assert.equal(foreignRes.code, 403);
  } finally {
    Lead.findById = originalLeadFindById;
  }
});

test('FollowUp flow: createFollowUp, getTodayFollowUps, and completeFollowUp', async () => {
  const agentId = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId();

  let storedFollowUp = null;
  const originalCreate = FollowUp.create;
  const originalFind = FollowUp.find;
  const originalFindById = FollowUp.findById;
  const originalFindOneAndUpdate = FollowUp.findOneAndUpdate;

  FollowUp.create = async (doc) => {
    storedFollowUp = {
      _id: new mongoose.Types.ObjectId(),
      ...doc,
      status: doc.status || "pending",
      save: async function () { return this; }
    };
    return storedFollowUp;
  };

  FollowUp.findById = () => ({
    populate: () => Promise.resolve(storedFollowUp)
  });

  FollowUp.find = () => ({
    populate: () => ({
      sort: () => Promise.resolve([storedFollowUp])
    })
  });

  FollowUp.findOneAndUpdate = async (filter, update) => {
    if (storedFollowUp) {
      if (filter.agent && String(filter.agent) !== String(storedFollowUp.agent)) {
        return null;
      }
      Object.assign(storedFollowUp, update);
      return storedFollowUp;
    }
    return null;
  };

  try {
    // 1. createFollowUp
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let createRes = {};
    await followupController.createFollowUp({
      body: { leadId: leadId.toString(), date: futureDate, note: "Call back to confirm admission" },
      user: { _id: agentId }
    }, {
      status: (code) => ({ json: (data) => { createRes = { code, data }; } }),
      json: (data) => { createRes = { code: 200, data }; }
    });

    assert.equal(createRes.code, 201);
    assert.ok(storedFollowUp);
    assert.equal(storedFollowUp.lead.toString(), leadId.toString());
    assert.equal(storedFollowUp.status, "pending");
    assert.equal(storedFollowUp.note, "Call back to confirm admission");

    // 2. getTodayFollowUps
    let todayRes = {};
    await followupController.getTodayFollowUps({ user: { _id: agentId } }, {
      json: (data) => { todayRes = { code: 200, data }; }
    });
    assert.equal(todayRes.code, 200);
    assert.ok(Array.isArray(todayRes.data));

    // 3. completeFollowUp fails for different agent (no unrestricted fallback)
    const unauthorizedAgentId = new mongoose.Types.ObjectId();
    let unauthRes = {};
    await followupController.completeFollowUp({
      params: { id: storedFollowUp._id.toString() },
      user: { _id: unauthorizedAgentId, role: "telecaller" }
    }, {
      json: (data) => { unauthRes = { code: 200, data }; },
      status: (code) => ({ json: (data) => { unauthRes = { code, data }; } })
    });
    assert.equal(unauthRes.code, 404);

    // 4. completeFollowUp succeeds for authorized agent
    let compRes = {};
    await followupController.completeFollowUp({
      params: { id: storedFollowUp._id.toString() },
      user: { _id: agentId, role: "telecaller" }
    }, {
      json: (data) => { compRes = { code: 200, data }; },
      status: (code) => ({ json: (data) => { compRes = { code, data }; } })
    });

    assert.equal(compRes.code, 200);
    assert.equal(storedFollowUp.status, "done");
  } finally {
    FollowUp.create = originalCreate;
    FollowUp.find = originalFind;
    FollowUp.findById = originalFindById;
    FollowUp.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
