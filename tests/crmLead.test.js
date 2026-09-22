const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const mongoose = require('mongoose');
const validator = require('validator');
const company = '507f1f77bcf86cd799439010';
const id = '507f1f77bcf86cd799439011';
const body = { fullName:' Test Client ', email:'CLIENT@example.com', phone:'9876543210', gender:'Female', leadDate:'2026-09-15', leadType:id, leadSource:id, customField1:'One', customField2:'Two', customField3:'Three', customField4:'Four', customField5:'Five', remarks:'Notes' };
function load({ active=true, create=async data=>data }={}) {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'),'utf8'),{
    module, exports:module.exports,
    require(name){
      if(name==='mongoose')return mongoose;
      if(name==='validator')return validator;
      if(name==='../models/Lead')return {create};
      return {findOne:filter=>{assert.equal(filter.company,company);assert.equal(filter.status,'Active');return {lean:async()=>active?{name:'Website'}:null};}};
    }
  });
  return module.exports;
}
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;}});
test('validates dates, email, phone, required fields and master IDs',()=>{
  const c=load(); assert.equal(Object.keys(c.validate(body).errors).length,0);
  for(const [key,value] of Object.entries({fullName:'',email:'invalid',phone:'123',leadDate:'2026-02-30',leadType:'bad',leadSource:'bad',gender:'invalid'})) assert.ok(c.validate({...body,[key]:value}).errors[key],key);
  assert.equal(c.validate(body).data.name,'Test Client');
  assert.equal(c.validate(body).data.email,'client@example.com');
});
test('saves every custom field and forces company, creator, new status and unassigned',async()=>{
  const res=response();
  await load().create({body:{...body,company:'foreign',status:'converted',assignedTo:id,createdBy:'foreign'},crmCompany:company,user:{id}},res,error=>{throw error;});
    assert.equal(res.code,201); const item=res.body.item;
    assert.equal(item.company,company);assert.equal(item.status,'new');assert.equal(item.assignedTo,null);assert.equal(item.createdBy,id);
    assert.equal(item.gender, body.gender);
  for(const key of ['customField1','customField2','customField3','customField4','customField5','remarks'])assert.equal(item[key],body[key]);
});
test('rejects inactive or foreign-company classification before saving',async()=>{
  const res=response();
  await load({active:false,create:()=>assert.fail('Must not save')}).create({body,crmCompany:company,user:{id}},res,error=>{throw error;});
  assert.equal(res.code,400);assert.ok(res.body.errors.leadType);assert.ok(res.body.errors.leadSource);
});
test('invalid form never reaches database creation',async()=>{
  const res=response();
  await load({create:()=>assert.fail('Must not save')}).create({body:{},crmCompany:company,user:{id}},res,error=>{throw error;});
  assert.equal(res.code,400);assert.ok(res.body.errors.fullName);
});

test('options fetches active types and sources scoped to company', async () => {
  const res = response();
  const ctl = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'), 'utf8'), {
    module: ctl, exports: ctl.exports,
    require(name) {
      if (name === 'mongoose') return mongoose;
      if (name === 'validator') return validator;
      if (name === '../models/LeadType' || name === '../models/LeadSource') {
        return {
          find: filter => {
            assert.equal(filter.company, company);
            assert.equal(filter.status, 'Active');
            return {
              select: () => ({
                sort: () => ({
                  lean: async () => [{ _id: id, name: name.includes('Type') ? 'NEET' : 'Website' }]
                })
              })
            };
          }
        };
      }
      return {};
    }
  });
  await ctl.exports.options({ crmCompany: company }, res, error => { throw error; });
  assert.equal(res.body.types[0].name, 'NEET');
  assert.equal(res.body.sources[0].name, 'Website');
});

test('list returns populated leads scoped to company', async () => {
  const res = response();
  const ctl = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'), 'utf8'), {
    module: ctl, exports: ctl.exports,
    require(name) {
      if (name === 'mongoose') return mongoose;
      if (name === 'validator') return validator;
      if (name === '../models/Lead') {
        return {
          find: filter => {
            assert.equal(filter.company, company);
            return {
              sort: () => ({
                populate: () => ({
                  populate: () => ({
                    populate: () => ({
                      lean: async () => [{ _id: id, name: 'Aman Sharma', status: 'new' }]
                    })
                  })
                })
              })
            };
          }
        };
      }
      return {};
    }
  });
  await ctl.exports.list({ crmCompany: company }, res, error => { throw error; });
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].name, 'Aman Sharma');
});

test('team lists all active company employees without requiring telecaller page access', async () => {
  const res = response();
  const ctl = { exports: {} };
  const activeEmployee = { _id: id, name: 'Regular Employee', role: 'user', isActive: true };
  const clientUser = { _id: '507f1f77bcf86cd799439012', name: 'Client User', role: 'client', isActive: true };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'), 'utf8'), {
    module: ctl, exports: ctl.exports,
    require(name) {
      if (name === 'mongoose') return { ...mongoose, models: {} };
      if (name === 'validator') return validator;
      if (name === '../models/User') return {
        find: filter => {
          assert.equal(filter.company, company);
          assert.equal(filter.isActive.$ne, false);
          const chain = { select: () => chain, sort: () => chain, lean: async () => [activeEmployee, clientUser] };
          return chain;
        }
      };
      if (name === '../HR-CDS/models/Client') return {
        find: () => ({ select: () => ({ lean: async () => [] }) })
      };
      return {};
    }
  });
  await ctl.exports.team({ crmCompany: company }, res, error => { throw error; });
  assert.deepEqual(Array.from(res.body.users, user => user.name), ['Regular Employee']);
});

test('assign updates assignedTo and assignedAt or unassigns when userId is empty', async () => {
  const ctl = { exports: {} };
  const leadDoc = { _id: id, company, assignedTo: null, assignedAt: null, save: async () => {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'), 'utf8'), {
    module: ctl, exports: ctl.exports,
    require(name) {
      if (name === 'mongoose') return { ...mongoose, isValidObjectId: val => mongoose.isValidObjectId(val) };
      if (name === 'validator') return validator;
      if (name === '../models/Lead') {
        return {
          findOne: filter => (filter._id === id && filter.company === company ? leadDoc : null),
          findById: () => {
            const chain = {
              populate: () => chain,
              lean: async () => ({ ...leadDoc, assignedTo: { _id: id, name: 'Telecaller 1' } })
            };
            return chain;
          }
        };
      }
      if (name === '../models/User') {
        return {
          findOne: filter => ({
            lean: async () => ({
              _id: filter._id,
              name: 'Telecaller 1',
              role: 'user',
              companyRole: 'employee',
              isActive: true
            })
          })
        };
      }
      if (name === '../utils/telecallerUsers') return { hasTelecallerAccess: async () => true };
      if (name === '../HR-CDS/models/Client') {
        return {
          findOne: () => ({ select: () => ({ lean: async () => null }) })
        };
      }
      return {};
    }
  });

  // Test Assign
  const assignRes = response();
  await ctl.exports.assign({ params: { id }, body: { userId: id }, crmCompany: company }, assignRes, error => { throw error; });
  assert.equal(assignRes.code, 200);
  assert.ok(assignRes.body.message.includes('Telecaller 1'));

  const sameAssigneeRes = response();
  await ctl.exports.assign({ params: { id }, body: { userId: id }, crmCompany: company }, sameAssigneeRes, error => { throw error; });
  assert.equal(sameAssigneeRes.code, 400);
  assert.match(sameAssigneeRes.body.message, /already assigned/i);

  const transferRes = response();
  await ctl.exports.assign({ params: { id }, body: { userId: new mongoose.Types.ObjectId() }, crmCompany: company }, transferRes, error => { throw error; });
  assert.equal(transferRes.code, 400);
  assert.match(transferRes.body.message, /transfer reason/i);

  // Test Unassign
  const unassignRes = response();
  await ctl.exports.assign({ params: { id }, body: { userId: null }, crmCompany: company }, unassignRes, error => { throw error; });
  assert.equal(unassignRes.code, 200);
  assert.ok(unassignRes.body.message.includes('unassigned'));
});
