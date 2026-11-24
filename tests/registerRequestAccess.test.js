const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Types } = require('mongoose');
const Company = require('../models/Company');
const JobRole = require('../models/JobRole');
const PageActivity = require('../models/PageActivity');
const PagePermission = require('../models/PagePermission');
const SidebarConfig = require('../models/SidebarConfig');
const User = require('../models/User');
const { getRegisterRequestAccess, REGISTER_REQUEST_PATH } = require('../utils/registerRequestAccess');
const { activateRegisterRequest, verifyRegisterRequestSection } = require('../HR-CDS/controllers/userControllers');
const { flush, trackWrites } = require('../utils/activityTracker');

const id = () => new Types.ObjectId();
const query = value => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => value,
});

const fixture = (t, allowedPages = ['register-request']) => {
  const user = { _id: id(), name: 'Reviewer', company: id(), companyCode: 'TEST', companyRole: 'employee', department: id(), jobRole: 'Recruiter', branch: id() };
  const sidebarItem = { id: 'register-request', path: REGISTER_REQUEST_PATH };
  const config = { menuItems: [sidebarItem] };
  t.mock.method(Company, 'findById', () => query({ isActive: true, allowedPages }));
  t.mock.method(PagePermission, 'findOne', () => query(null));
  t.mock.method(JobRole, 'find', () => query([]));
  t.mock.method(SidebarConfig, 'findOne', filter => {
    assert.equal(filter.companyId, String(user.company));
    assert.equal(filter.departmentId, String(user.department));
    assert.ok(filter.branchId || filter.$or, 'Only the assigned branch or a company-wide menu can grant access');
    return { sort: async () => filter.branchId === String(user.branch) ? config : null };
  });
  return { user, sidebarItem };
};

test('Register Request in the assigned sidebar grants acceptance access on an eligible plan', async t => {
  const { user, sidebarItem } = fixture(t);
  assert.deepEqual(await getRegisterRequestAccess(user), { canView: true, canVerify: false });
  assert.deepEqual(await getRegisterRequestAccess({ ...user, branch: id() }), { canView: false, canVerify: false });
  sidebarItem.disabled = true;
  assert.deepEqual(await getRegisterRequestAccess(user), { canView: false, canVerify: false });
});

test('A sidebar assignment cannot grant access outside the company plan', async t => {
  const { user } = fixture(t, ['emp-details']);
  assert.deepEqual(await getRegisterRequestAccess(user), { canView: false, canVerify: false });
  assert.equal(SidebarConfig.findOne.mock.callCount(), 0);
});

test('Only the successful pending-to-active transition logs who accepted whom', async t => {
  const { user } = fixture(t);
  const applicant = {
    _id: id(), company: user.company, name: 'Applicant', companyRole: 'employee',
    registrationSource: 'self_register', registrationStatus: 'pending',
    registrationVerification: { sections: { applicationReview: { verified: true } } }
  };
  t.mock.method(User, 'findOne', async filter => {
    assert.equal(String(filter.company), String(user.company));
    return applicant;
  });
  t.mock.method(User.collection, 'findOne', async () => applicant);
  let accepted = false;
  t.mock.method(User, 'findOneAndUpdate', (filter, { $set: update }) => {
    assert.equal(filter.registrationStatus, 'pending');
    assert.equal(filter.companyRole, 'employee');
    assert.equal(filter.$or[0].branch.$in[0], String(user.branch));
    if (accepted) return query(null);
    accepted = true;
    return query({
      ...applicant, registrationStatus: update.registrationStatus,
      registrationVerification: { activatedBy: update['registrationVerification.activatedBy'] }
    });
  });
  const records = [];
  t.mock.method(PageActivity, 'insertMany', async rows => records.push(...rows));

  const run = async (handler, body = {}, endpoint = 'activate') => {
    const req = { user, body, params: { id: applicant._id }, method: 'PATCH', originalUrl: `/api/users/register-requests/${applicant._id}/${endpoint}`, get: () => '' };
    const res = Object.assign(new EventEmitter(), {
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.emit('finish'); }
    });
    trackWrites(req, res, () => {});
    await handler(req, res);
    return res;
  };

  assert.equal((await run(verifyRegisterRequestSection, { sectionKey: 'salaryBankDetails', verified: true }, 'verify-section')).statusCode, 403);
  applicant.companyRole = 'admin';
  assert.equal((await run(activateRegisterRequest)).statusCode, 403);
  applicant.companyRole = 'employee';
  const results = await Promise.all([run(activateRegisterRequest), run(activateRegisterRequest)]);
  assert.deepEqual(results.map(res => res.statusCode).sort(), [200, 409]);
  assert.equal(results.find(res => res.statusCode === 200).body.request.registrationVerification.activatedBy, user._id);
  await flush();
  assert.equal(records.length, 1);
  assert.equal(String(records[0].user), String(user._id));
  assert.equal(records[0].path, REGISTER_REQUEST_PATH);
  assert.equal(records[0].summary, 'Accepted registration request for Applicant');
});
