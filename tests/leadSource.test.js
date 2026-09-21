const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const mongoose = require('mongoose');

function controller(model = {}, used = null) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/leadSourceController'), 'utf8'), {
    module, exports: module.exports,
    require: name => name === '../models/LeadSource' ? model : {
      isValidObjectId: mongoose.isValidObjectId, Types: mongoose.Types,
      connection: { collection: () => ({ findOne: async () => used }) }
    }
  });
  return module.exports;
}
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('normalizes names, accepts requests without sort order and validates status', () => {
  const { validate } = controller();
  assert.equal(validate({name:'  Google   Ads ',sort:0}).normalizedName, 'google ads');
  assert.equal(validate({name:'Facebook',status:'Inactive'}).status, 'Inactive');
  assert.equal('sort' in validate({name:'Facebook'}), false);
  assert.throws(() => validate({name:' ',sort:1}));
  assert.throws(() => validate({name:'Facebook',status:'unknown'}));
});
test('create uses authenticated company and creator, ignoring submitted ownership', async () => {
  let saved;
  const c = controller({create: async data => { saved = data; return data; }});
  const res = response();
  await c.create({body:{name:'Facebook',company:'other',createdBy:'other',isSystem:true},leadSourceCompany:'own',user:{id:'me'}},res);
  assert.equal(res.code,201);
  assert.equal(saved.company,'own'); assert.equal(saved.createdBy,'me'); assert.equal(saved.isSystem,false);
});
test('update is scoped to authenticated company and returns 404 for unavailable records', async () => {
  let filter;
  const c = controller({findOneAndUpdate: async query => { filter=query; return null; }});
  const res=response();
  await c.update({params:{id:'507f1f77bcf86cd799439011'},body:{name:'Facebook'},leadSourceCompany:'own'},res);
  assert.equal(filter.company,'own'); assert.equal(res.code,404);
});
test('duplicate database constraint returns a useful conflict', async () => {
  const c=controller({create:async()=>{throw {code:11000};}}); const res=response();
  await c.create({body:{name:'Facebook'},leadSourceCompany:'own',user:{id:'me'}},res);
  assert.equal(res.code,409);
});
test('used sources cannot be deleted and system sources are excluded atomically', async () => {
  const req={params:{id:'507f1f77bcf86cd799439011'},leadSourceCompany:'own'};
  const usedRes=response();
  await controller({}, {_id:'lead'}).remove(req,usedRes); assert.equal(usedRes.code,409);
  let filter; const res=response();
  await controller({findOneAndDelete:async query=>{filter=query;return null;}}).remove(req,res);
  assert.equal(filter.company,'own'); assert.equal(filter.isSystem,false); assert.equal(res.code,409);
});

test('lead source permissions enforce company enablement and page action grants', async () => {
  const user='507f1f77bcf86cd799439011'; const company='507f1f77bcf86cd799439012';
  let allowedPages=['admin-crm-lead-sources'];
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/leadSourcePermission'),'utf8'), {
    module,
    require: name => name === 'mongoose' ? mongoose : name === '../models/Company'
      ? {findById:()=>({select:()=>({lean:async()=>({allowedPages})})})}
      : name === './crmPagePermission' ? { requireCrmPagePermission: (path, action) => (req, res, next) => {
        assert.equal(path, '/ciisUser/crm/admin/lead-sources'); assert.ok(['view', 'edit', 'delete'].includes(action)); next();
      } } : assert.fail(`Unexpected dependency: ${name}`)
  });
  const req={user:{id:user,company,companyRole:'hr'}};
  for (const action of ['view','edit','delete']) {
    let next=false;
    await module.exports(action)(req,response(),()=>{next=true;});
    assert.equal(next,true);
    assert.equal(req.leadSourceCompany,company);
  }
  const invalid=response();
  await module.exports('edit')({user:{id:user}},invalid,()=>assert.fail('Missing company'));
  assert.equal(invalid.code,403);
  allowedPages=['user-dashboard'];
  const disabled=response(); await module.exports('view')(req,disabled,()=>assert.fail('Disabled company page'));
  assert.equal(disabled.code,403);
});
