// Creates an isolated testing tenant. Password is read from stdin, never saved.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
mongoose.set('autoIndex', false);
const models = Object.fromEntries(['Company','Branch','Department','JobRole','User','PagePermission','PageDataVisibility','MenuAccess','SidebarConfig'].map(n => [n, require('../models/' + n)]));
const code = 'TECHSOFT';
const email = 'vansh24810@gmail.com';
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k,obj[k]]));
async function main() {
  const password = fs.readFileSync(0,'utf8').trim();
  if (password.length < 8) throw new Error('Supply the testing password on stdin');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const source = await models.Company.findOne({companyCode:'CAREER'}).lean();
  if (!source) throw new Error('CAREER source missing');
  if (await models.Company.exists({$or:[{companyCode:code},{companyName:'techsoftsolutions'},{companyEmail:email}]})) throw new Error('Target already exists; refusing duplicate creation');
  const data = {};
  for (const n of ['Branch','Department','JobRole','User','PagePermission','PageDataVisibility']) data[n] = await models[n].find({company:source._id}).lean();
  data.SidebarConfig = await models.SidebarConfig.find({companyId:source._id}).lean();
  data.MenuAccess = await models.MenuAccess.find({department:{$in:data.Department.map(d=>d._id)}}).lean();
  const ids = new Map([[String(source._id), new mongoose.Types.ObjectId()]]);
  for (const rows of Object.values(data)) for (const row of rows) ids.set(String(row._id),new mongoose.Types.ObjectId());
  const remap = value => {
    if (value == null || value instanceof Date) return value;
    if (value instanceof mongoose.Types.ObjectId) return ids.get(String(value)) || value;
    if (typeof value === 'string') return ids.has(value) ? String(ids.get(value)) : value === 'CAREER' ? code : value;
    if (Array.isArray(value)) return value.map(remap);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));
    return value;
  };
  const sourceOwner = data.User.find(u => u.jobRole === 'super_admin' && String(u.companyRole).toLowerCase() === 'owner');
  if (!sourceOwner) throw new Error('Source owner missing');
  const ownerId = ids.get(String(sourceOwner._id));
  const companyId = ids.get(String(source._id));
  const now = new Date();
  const company = new models.Company({
    ...pick(source,['selectedPlan','subscriptionPlan','planFeatures','allowedPages','allowedSuperAdminPages','dashboardConfig']),
    _id:companyId, companyName:'techsoftsolutions', companyCode:code, companyEmail:email,
    companyAddress:'Testing office - Panchkula', companyPhone:'0000000000', ownerName:'Vansh',
    loginUrl:`https://cds.ciisnetwork.in/company/${code}/login`, dbIdentifier:`company_${code}_${Date.now()}`,
    isActive:true, subscriptionExpiry:new Date(Date.now()+365*86400000), planDurationDays:365,
    subscriptionAmount:0, subscriptionPaymentStatus:'waived', accessConfiguredAt:now
  });
  if (await models.Company.exists({companyPhone:company.companyPhone})) throw new Error('Dummy company phone already used');
  const branchCodes = new Map(data.Branch.map((b,i)=>[b.branchCode,b.isDefault?`${code}-HQ`:`${code}-BR${i+1}`]));
  const head = data.Branch.find(b=>b.isDefault) || data.Branch[0];
  const fresh = row => ({...remap(row),createdAt:now,updatedAt:now,__v:0});
  const target = {Company:[company]};
  target.Branch = data.Branch.map(b => new models.Branch({...fresh(b),branchCode:branchCodes.get(b.branchCode),phone:'',address:`Testing office - ${b.name}`}));
  target.Department = data.Department.map(d => new models.Department({...fresh(d),branch:ids.get(String(d.branch))||ids.get(String(head._id)),branchCode:branchCodes.get(d.branchCode)||branchCodes.get(head.branchCode),createdBy:ownerId}));
  target.JobRole = data.JobRole.map(r=>new models.JobRole({...fresh(r),createdBy:ownerId}));
  const hash = await bcrypt.hash(password,12);
  const roleMap = new Map(data.JobRole.map(r=>[String(r._id),r]));
  const departmentMap = new Map(data.Department.map(d=>[String(d._id),d]));
  const repairs = [];
  target.User = data.User.map((u,i)=>{
    const owner = String(u._id) === String(sourceOwner._id);
    const fields = remap(pick(u,['branch','assignedBranches','department','jobRole','companyRole','shiftId','shiftName','shiftType','reportingManager','employeeType','isActive']));
    if (/^[a-f0-9]{24}$/i.test(u.department) && !departmentMap.has(u.department)) {
      const role = roleMap.get(u.jobRole);
      if (!role) throw new Error('Cannot resolve missing user department');
      fields.department = String(ids.get(String(role.department)));
      repairs.push(`Test User ${i+1}: department repaired from job role`);
    }
    fields.branch = ids.get(String(u.branch)) || ids.get(String(head._id));
    fields.assignedBranches = (u.assignedBranches||[]).filter(b=>ids.has(String(b))).map(b=>ids.get(String(b)));
    fields.branchCode = target.Branch.find(b=>String(b._id)===String(fields.branch)).branchCode;
    fields.reportingManager = ids.get(String(u.reportingManager));
    return new models.User({...fields,_id:ids.get(String(u._id)),company:companyId,companyCode:code,
      name:owner?'Vansh':`Test User ${String(i+1).padStart(3,'0')}`,
      email:owner?email:`techsoft.user${String(i+1).padStart(3,'0')}@example.com`,password:hash,
      employeeId:`${code}-EMP-${String(i+1).padStart(4,'0')}`,createdBy:owner?null:ownerId,
      isVerified:true,registrationStatus:'active',dateOfJoining:now,createdAt:now,updatedAt:now,
      additionalDetails:'Synthetic account for techsoftsolutions testing',notificationPreferences:{email:false}
    });
  });
  for (const n of ['PagePermission','PageDataVisibility','MenuAccess','SidebarConfig']) target[n] = data[n].map(r=>new models[n](fresh(r)));
  for (const d of target.Department) if(d.supportHead) d.supportHeadName=target.User.find(u=>String(u._id)===String(d.supportHead))?.name || '';
  for (const d of target.PageDataVisibility) if(d.subjectType==='user') d.subjectLabel=target.User.find(u=>String(u._id)===d.subjectKey)?.name || 'Test User';
  // Reject any retained source tenant references before writing.
  for (const [name,docs] of Object.entries(target)) for (const doc of docs) {
    await doc.validate();
    const serialized=JSON.stringify(doc.toObject());
    for(const oldId of ids.keys()) if(serialized.includes(oldId)) throw new Error(`Unmapped source reference in ${name}`);
  }
  const summary={company:'techsoftsolutions',companyCode:code,loginUrl:company.loginUrl,counts:Object.fromEntries(Object.entries(target).map(([n,docs])=>[n,docs.length])),repairs};
  console.log(JSON.stringify(summary));
  if(!process.argv.includes('--apply')) return;
  const session=await mongoose.startSession();
  try {
    await session.withTransaction(async()=>{
      for(const [n,docs] of Object.entries(target)) if(docs.length) await models[n].collection.insertMany(docs.map(d=>d.toObject({virtuals:false})),{session});
    });
  } finally {await session.endSession();}
  for(const [n,docs] of Object.entries(target)) {
    const count=await models[n].countDocuments({_id:{$in:docs.map(d=>d._id)}});
    if(count!==docs.length) throw new Error(`Verification failed: ${n}`);
  }
  const owner=await models.User.findById(ownerId).select('+password');
  if(!await owner.comparePassword(password)) throw new Error('Password verification failed');
  const report={...summary,passwordVerified:true,users:target.User.map(u=>({name:u.name,email:u.email,active:u.isActive,companyRole:u.companyRole,department:target.Department.find(d=>String(d._id)===u.department)?.name||u.department,jobRole:target.JobRole.find(r=>String(r._id)===u.jobRole)?.name||u.jobRole,branch:target.Branch.find(b=>String(b._id)===String(u.branch))?.name}))};
  fs.writeFileSync(require('path').resolve(__dirname,'../../audit-tools/techsoftsolutions-setup.json'),JSON.stringify(report,null,2));
  console.log('COMMITTED: counts, tenant reference isolation and owner password verified.');
}
main().catch(e=>{console.error(e.name,e.message.replace(/mongodb\S*/g,'[redacted]'));process.exitCode=1}).finally(()=>mongoose.disconnect());
