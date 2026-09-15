const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const mongoose = require('mongoose');
const validator = require('validator');
const company = '507f1f77bcf86cd799439010';
const id = '507f1f77bcf86cd799439011';
const body = { fullName:' Test Client ', email:'CLIENT@example.com', phone:'+91 98765 43210', leadDate:'2026-09-15', leadType:id, leadSource:id, customField1:'One', customField2:'Two', customField3:'Three', customField4:'Four', customField5:'Five', remarks:'Notes' };
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
