const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const controller = require('../controllers/crmAssignmentController');
const Lead = require('../models/Lead');
const User = require('../models/User');
const History = require('../models/LeadAssignmentHistory');
const Client = require('../HR-CDS/models/Client');
const PagePermission = require('../models/PagePermission');

const company = new mongoose.Types.ObjectId();
const agent = new mongoose.Types.ObjectId();
const leadId = new mongoose.Types.ObjectId();
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('assignment overview paginates/searches unassigned leads and returns telecallers', async () => {
  const originals = { leadCount: Lead.countDocuments, leadFind: Lead.find, userFind: User.find, historyFind: History.find, clientFind: Client.find, permissionFind: PagePermission.find };
  let leadFilter; let userFilter;
  Client.find = () => ({ select: () => ({ lean: async () => [] }) });
  PagePermission.find = () => ({ select: () => ({ lean: async () => [{ path: '/ciisUser/telecaller/dashboard', viewUsers: [{ user: agent }] }] }) });
  Lead.countDocuments = async filter => filter.assignedTo === null ? 1 : filter.assignedTo?.$ne === null ? 2 : 3;
  Lead.find = filter => {
    leadFilter = filter;
    const chain = { select: () => chain, populate: () => chain, sort: () => chain, skip: value => { assert.equal(value, 10); return chain; }, limit: value => { assert.equal(value, 10); return chain; }, lean: async () => [{ _id: leadId, name: 'Aman' }] };
    return chain;
  };
  User.find = filter => {
    userFilter = filter;
    const chain = { select: () => chain, sort: () => chain, lean: async () => [{ _id: agent, name: 'Caller', role: 'telecaller' }] };
    return chain;
  };
  History.find = () => {
    const chain = { sort: () => chain, limit: () => chain, populate: () => chain, lean: async () => [] };
    return chain;
  };
  try {
    const res = response();
    await controller.overview({ crmCompany: company, query: { page: '2', limit: '10', search: 'Aman' } }, res, error => { throw error; });
    assert.equal(res.body.unassigned.length, 1);
    assert.equal(res.body.pagination.page, 2);
    assert.ok(leadFilter.$or.every(condition => Object.values(condition)[0].$regex === 'Aman'));
    assert.deepEqual(userFilter._id.$in, [String(agent)], 'assignment candidates must have telecaller page access');
  } finally {
    Lead.countDocuments = originals.leadCount; Lead.find = originals.leadFind; User.find = originals.userFind;
    History.find = originals.historyFind; Client.find = originals.clientFind; PagePermission.find = originals.permissionFind;
  }
});

test('bulk assignment rejects a candidate that is not an active telecaller', async () => {
  const originals = { leadFind: Lead.find, userFind: User.find, clientFind: Client.find, permissionFind: PagePermission.find };
  Client.find = () => ({ select: () => ({ lean: async () => [] }) });
  PagePermission.find = () => ({ select: () => ({ lean: async () => [{ path: '/ciisUser/telecaller/dashboard', viewUsers: [{ user: agent }] }] }) });
  Lead.find = () => ({ select: () => ({ lean: async () => [{ _id: leadId, assignedTo: null }] }) });
  User.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    const res = response();
    await controller.bulkAssign({ crmCompany: company, user: { _id: agent }, body: { leadIds: [String(leadId)], method: 'specific', agentId: String(agent) } }, res, error => { throw error; });
    assert.equal(res.code, 400);
    assert.match(res.body.message, /telecaller/i);
  } finally {
    Lead.find = originals.leadFind; User.find = originals.userFind; Client.find = originals.clientFind; PagePermission.find = originals.permissionFind;
  }
});
