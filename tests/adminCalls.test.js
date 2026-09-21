const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const adminCallController = require('../controllers/adminCallController');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const User = require('../models/User');
const PagePermission = require('../models/PagePermission');

test('Admin CRM: dashboard endpoint aggregates company metrics, pipeline, trends, and team performance', async () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const originalLeadCount = Lead.countDocuments;
  const originalCallCount = CallLog.countDocuments;
  const originalFollowCount = FollowUp.countDocuments;
  const originalUserFind = User.find;
  const originalLeadAggregate = Lead.aggregate;
  const originalCallAggregate = CallLog.aggregate;
  const originalCallFind = CallLog.find;
  const originalPermissionFind = PagePermission.find;

  Lead.countDocuments = async (filter) => {
    if (filter.status === 'converted') return 5;
    if (filter.assignedTo === null) return 10;
    return 25;
  };
  CallLog.countDocuments = async (filter) => {
    if (filter.createdAt) return 8; // today's calls
    return 40; // total calls
  };
  FollowUp.countDocuments = async () => 3;
  PagePermission.find = () => ({ select: () => ({ lean: async () => [{ path: '/ciisUser/telecaller/dashboard', viewUsers: [{ user: userId }] }] }) });

  User.find = () => ({
    select: () => ({
      lean: async () => [
        { _id: userId, name: 'Telecaller Test', role: 'telecaller' }
      ]
    })
  });

  Lead.aggregate = async (pipeline) => {
    if (pipeline[1]?.$group?._id === '$status') {
      return [
        { _id: 'new', count: 10 },
        { _id: 'interested', count: 5 },
        { _id: 'converted', count: 5 },
        { _id: 'follow-up', count: 5 }
      ];
    }
    // Trend or agent leads facet
    return [];
  };

  CallLog.aggregate = async () => [];
  CallLog.find = () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => []
          })
        })
      })
    })
  });

  try {
    let result = null;
    const req = { crmCompany: companyId };
    const res = {
      json: (data) => { result = data; }
    };

    await adminCallController.dashboard(req, res, (err) => { throw err; });

    assert.ok(result);
    assert.equal(result.metrics.totalLeads, 25);
    assert.equal(result.metrics.totalCalls, 40);
    assert.equal(result.metrics.todaysCalls, 8);
    assert.equal(result.metrics.activeUsers, 1);
    assert.equal(result.metrics.conversionRate, '20%');
    assert.ok(Array.isArray(result.pipelineData));
    assert.ok(Array.isArray(result.trendData));
    assert.equal(result.trendData.length, 30);
    assert.ok(Array.isArray(result.teamPerformance));
    assert.equal(result.teamPerformance.length, 1);
    assert.equal(result.teamPerformance[0].member, 'Telecaller Test');
  } finally {
    Lead.countDocuments = originalLeadCount;
    CallLog.countDocuments = originalCallCount;
    FollowUp.countDocuments = originalFollowCount;
    User.find = originalUserFind;
    Lead.aggregate = originalLeadAggregate;
    CallLog.aggregate = originalCallAggregate;
    CallLog.find = originalCallFind;
    PagePermission.find = originalPermissionFind;
  }
});

test('Admin CRM: call overview endpoint returns statCards, quickAccessCounts, and trends', async () => {
  const companyId = new mongoose.Types.ObjectId();

  const originalLeadCount = Lead.countDocuments;
  const originalCallCount = CallLog.countDocuments;
  const originalFollowCount = FollowUp.countDocuments;
  const originalCallFind = CallLog.find;
  const originalCallAggregate = CallLog.aggregate;

  Lead.countDocuments = async (filter) => {
    if (filter.status === 'converted') return 4;
    if (filter.assignedTo) return 15;
    if (filter.nextFollowUp) return 7;
    return 20;
  };
  CallLog.countDocuments = async (filter) => {
    if (filter.createdAt) return 6;
    return 30;
  };
  FollowUp.countDocuments = async () => 5;

  CallLog.find = () => ({
    sort: () => ({
      limit: () => ({
        populate: () => ({
          populate: () => ({
            lean: async () => []
          })
        })
      })
    })
  });

  CallLog.aggregate = async (pipeline) => {
    if (pipeline[1]?.$group?._id === '$status') {
      return [
        { _id: 'answered', count: 20 },
        { _id: 'missed', count: 10 }
      ];
    }
    return [];
  };

  try {
    let result = null;
    const req = { crmCompany: companyId };
    const res = {
      json: (data) => { result = data; }
    };

    await adminCallController.overview(req, res, (err) => { throw err; });

    assert.ok(result);
    assert.ok(Array.isArray(result.statCards));
    assert.equal(result.statCards[0].value, '15'); // Assigned leads
    assert.equal(result.statCards[1].value, '6');  // Today's calls
    assert.equal(result.quickAccessCounts.today, 6);
    assert.equal(result.quickAccessCounts.history, 30);
    assert.equal(result.trendData.length, 7);
    assert.ok(result.outcomeData.length >= 2);
  } finally {
    Lead.countDocuments = originalLeadCount;
    CallLog.countDocuments = originalCallCount;
    FollowUp.countDocuments = originalFollowCount;
    CallLog.find = originalCallFind;
    CallLog.aggregate = originalCallAggregate;
  }
});
