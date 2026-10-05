require('dotenv').config({quiet:true});
const m=require('mongoose');
const fs=require('fs');
const path=require('path');
async function main(){
 await m.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});
 const db=m.connection.db;
 const source=await db.collection('companies').findOne({companyCode:'CAREER'});
 const target=await db.collection('companies').findOne({companyCode:'TECHSOFT',companyName:'techsoftsolutions'});
 if(!source||!target) throw new Error('Company missing');
 const original=await db.collection('users').find({company:source._id}).toArray();
 const users=await db.collection('users').find({company:target._id}).sort({employeeId:1}).toArray();
 if(original.length!==68||users.length!==68) throw new Error('Source roster changed; mapping requires review');
 const roles=await db.collection('jobroles').find({company:{$in:[source._id,target._id]}}).toArray();
 const roleName=id=>roles.find(r=>String(r._id)===String(id))?.name||String(id);
 const changes=[];const emails=new Set();
 for(let i=0;i<users.length;i++){  
  const u=users[i],s=original[i];
  if(u.employeeId!==`TECHSOFT-EMP-${String(i+1).padStart(4,'0')}`||roleName(u.jobRole)!==roleName(s.jobRole)||u.companyRole!==s.companyRole) throw new Error(`Source mapping mismatch at ${i+1}`);
  // Preserve the explicitly requested owner login.
  if(u.email==='vansh24810@gmail.com') continue;
  let username=s.name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')||`user${i+1}`;
  let email=`test+${username}@example.com`;
  if(emails.has(email)) email=`test+${username}.${i+1}@example.com`;
  emails.add(email);
  changes.push({id:u._id,name:s.name,email,oldEmail:u.email});
 }
 const session=await m.startSession();
 try{await session.withTransaction(async()=>{
  await db.collection('users').bulkWrite(changes.map(c=>({updateOne:{filter:{_id:c.id,company:target._id},update:{$set:{name:c.name,email:c.email,updatedAt:new Date()}}}})),{session});
  await db.collection('departments').bulkWrite(changes.map(c=>({updateMany:{filter:{company:target._id,supportHead:c.id},update:{$set:{supportHeadName:c.name}}}})),{session});
  await db.collection('pagedatavisibilities').bulkWrite(changes.map(c=>({updateMany:{filter:{company:target._id,subjectType:'user',subjectKey:String(c.id)},update:{$set:{subjectLabel:c.name}}}})),{session});
 });}finally{await session.endSession();}
 const saved=await db.collection('users').find({company:target._id}).toArray();
 for(const c of changes){const u=saved.find(u=>String(u._id)===String(c.id));if(u?.name!==c.name||u?.email!==c.email)throw new Error('Verification failed');}
 const reportPath=path.resolve(__dirname,'../../audit-tools/techsoftsolutions-setup.json');
 const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 for(const u of report.users){const c=changes.find(c=>c.oldEmail===u.email);if(c){u.name=c.name;u.email=c.email;}}
 report.userNamesUpdatedAt=new Date().toISOString();fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 console.log(JSON.stringify({updated:changes.length,verified:true,ownerLogin:'vansh24810@gmail.com',examples:changes.slice(0,3).map(({name,email})=>({name,email}))}));
}
main().catch(e=>{console.error(e.name,e.message.replace(/mongodb\S*/g,'[redacted]'));process.exitCode=1}).finally(()=>m.disconnect());
