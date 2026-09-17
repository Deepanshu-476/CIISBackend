const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const company = '507f1f77bcf86cd799439010';
const user1 = '507f1f77bcf86cd799439011';
const user2 = '507f1f77bcf86cd799439012';
const leadId1 = '507f1f77bcf86cd799439021';
const leadId2 = '507f1f77bcf86cd799439022';

// Import Controllers
const optionsCtrl = require('../controllers/adminCalls/optionsController');
const overviewCtrl = require('../controllers/adminCalls/overviewController');
const assignedCtrl = require('../controllers/adminCalls/assignedController');
const todaysCtrl = require('../controllers/adminCalls/todaysController');
const pendingCtrl = require('../controllers/adminCalls/pendingController');
const scheduledCtrl = require('../controllers/adminCalls/scheduledController');
const completedCtrl = require('../controllers/adminCalls/completedController');
const convertedCtrl = require('../controllers/adminCalls/convertedController');
const transferredCtrl = require('../controllers/adminCalls/transferredController');
const historyCtrl = require('../controllers/adminCalls/historyController');

const Lead = require('../models/Lead');
const LeadTransfer = require('../models/LeadTransfer');
const LeadSource = require('../models/LeadSource');
const LeadType = require('../models/LeadType');
const User = require('../models/User');

const mockRes = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  }
});

test('optionsController returns master dropdowns and outcomes', async () => {
  const origSourceFind = LeadSource.find;
  const origTypeFind = LeadType.find;
  const origUserFind = User.find;

  LeadSource.find = () => ({ select: () => ({ sort: () => ({ lean: async () => [{ _id: 's1', name: 'Facebook' }] }) }) });
  LeadType.find = () => ({ select: () => ({ sort: () => ({ lean: async () => [{ _id: 't1', name: 'NEET' }] }) }) });
  User.find = () => ({ select: () => ({ sort: () => ({ lean: async () => [{ _id: user1, name: 'Telecaller 1' }] }) }) });

  try {
    const req = { crmCompany: company };
    const res = mockRes();
    await optionsCtrl.getOptions(req, res, err => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.sources.length, 1);
    assert.equal(res.data.leadTypes.length, 1);
    assert.equal(res.data.telecallers.length, 1);
    assert.ok(res.data.outcomes.includes('Connected'));
    assert.ok(res.data.callTypes.includes('Outbound'));
  } finally {
    LeadSource.find = origSourceFind;
    LeadType.find = origTypeFind;
    User.find = origUserFind;
  }
});

test('all 9 admin call controllers export valid handler functions', () => {
  assert.equal(typeof overviewCtrl.getOverview, 'function');
  assert.equal(typeof assignedCtrl.getAssignedCalls, 'function');
  assert.equal(typeof todaysCtrl.getTodaysCalls, 'function');
  assert.equal(typeof pendingCtrl.getPendingCalls, 'function');
  assert.equal(typeof scheduledCtrl.getScheduledCalls, 'function');
  assert.equal(typeof completedCtrl.getCompletedCalls, 'function');
  assert.equal(typeof convertedCtrl.getConvertedCalls, 'function');
  assert.equal(typeof transferredCtrl.getTransferredCalls, 'function');
  assert.equal(typeof transferredCtrl.createTransfer, 'function');
  assert.equal(typeof transferredCtrl.acceptTransfer, 'function');
  assert.equal(typeof historyCtrl.getCallHistory, 'function');
});

test('adminCallRoutes router contains all 9 required endpoints', () => {
  const router = require('../routes/adminCallRoutes');
  assert.ok(router);

  const routes = router.stack
    .filter(r => r.route)
    .map(r => ({
      path: r.route.path,
      method: Object.keys(r.route.methods)[0].toUpperCase()
    }));

  const paths = routes.map(r => r.path);
  assert.ok(paths.includes('/options'), 'missing /options');
  assert.ok(paths.includes('/overview'), 'missing /overview');
  assert.ok(paths.includes('/assigned'), 'missing /assigned');
  assert.ok(paths.includes('/today'), 'missing /today');
  assert.ok(paths.includes('/pending'), 'missing /pending');
  assert.ok(paths.includes('/scheduled'), 'missing /scheduled');
  assert.ok(paths.includes('/completed'), 'missing /completed');
  assert.ok(paths.includes('/converted'), 'missing /converted');
  assert.ok(paths.includes('/transferred'), 'missing /transferred');
  assert.ok(paths.includes('/history'), 'missing /history');
});

test('overviewController returns 4 stat cards, 2 mini tables, 2 charts, and recent calls', async () => {
  const origCount = Lead.countDocuments;
  const origAggregate = Lead.aggregate;
  const origFind = Lead.find;

  Lead.countDocuments = async () => 5;
  Lead.aggregate = async () => [
    {
      todaysCallsCount: [{ count: 12 }],
      trendCalls: [{ date: new Date(), outcome: 'Connected' }],
      outcomeCounts: [{ _id: 'Converted', count: 3 }],
      recentCalls: [{
        leadMongoId: leadId1,
        leadName: 'Test Student',
        phone: '9876543210',
        source: 'Facebook',
        leadType: 'NEET',
        callType: 'Outbound',
        outcome: 'Connected',
        remarks: 'Interested',
        callDate: new Date()
      }]
    }
  ];
  Lead.find = () => ({
    select: () => ({
      sort: () => ({
        limit: () => ({
          lean: async () => [{ _id: leadId1, name: 'Ashok', phone: '9876543210', nextFollowUp: new Date(), status: 'follow-up' }]
        })
      })
    })
  });

  try {
    const req = { crmCompany: company };
    const res = mockRes();
    await overviewCtrl.getOverview(req, res, err => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.stats.assignedLeads, 5);
    assert.equal(res.data.stats.todaysCalls, 12);
    assert.equal(res.data.stats.pendingFollowUps, 5);
    assert.equal(res.data.stats.convertedCalls, 5);
    assert.ok(Array.isArray(res.data.todaysFollowUps));
    assert.ok(Array.isArray(res.data.upcomingScheduledCalls));
    assert.ok(Array.isArray(res.data.trends));
    assert.equal(res.data.trends.length, 7);
    assert.ok(Array.isArray(res.data.outcomes));
    assert.equal(res.data.recentCalls.length, 1);
    assert.equal(res.data.recentCalls[0].name, 'Test Student');
  } finally {
    Lead.countDocuments = origCount;
    Lead.aggregate = origAggregate;
    Lead.find = origFind;
  }
});

test('assignedController returns paginated assigned leads', async () => {
  const origCount = Lead.countDocuments;
  const origFind = Lead.find;

  Lead.countDocuments = async () => 1;
  Lead.find = () => ({
    populate: () => ({
      populate: () => ({
        populate: () => ({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                lean: async () => [{
                  _id: leadId1,
                  name: 'Komal Wadhwa',
                  phone: '9598564205',
                  status: 'new',
                  assignedTo: { _id: user1, name: 'Telecaller 1' },
                  assignedAt: new Date()
                }]
              })
            })
          })
        })
      })
    })
  });

  try {
    const req = { crmCompany: company, query: { page: '1', limit: '10' } };
    const res = mockRes();
    await assignedCtrl.getAssignedCalls(req, res, err => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.total, 1);
    assert.equal(res.data.items[0].lead, 'Komal Wadhwa');
    assert.equal(res.data.items[0].assignedTo, 'Telecaller 1');
  } finally {
    Lead.countDocuments = origCount;
    Lead.find = origFind;
  }
});

