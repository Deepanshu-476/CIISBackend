require('dotenv').config({quiet:true});
const m=require('mongoose');
const fs=require('fs');
const path=require('path');
async function main(){
 await m.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});
 const db=m.connection.db;
 const company=await db.collection('companies').findOne({companyCode:'TECHSOFT',companyName:'techsoftsolutions'});
 if(!company)throw new Error('Company missing');
 const users=await db.collection('users').find({company:company._id}).toArray();
 const changes=users.filter(u=>u.email.startsWith('test+')).map(u=>({id:u._id,oldEmail:u.email,email:u.email.replace(/^test\+/,'test')}));
 const finalEmails=users.map(u=>changes.find(c=>String(c.id)===String(u._id))?.email||u.email);
 if(new Set(finalEmails).size!==users.length)throw new Error('Email collision');
 if(changes.length)await db.collection('users').bulkWrite(changes.map(c=>({updateOne:{filter:{_id:c.id,company:company._id,email:c.oldEmail},update:{$set:{email:c.email,updatedAt:new Date()}}}})));
 const saved=await db.collection('users').find({company:company._id},{projection:{email:1}}).toArray();
 for(const c of changes)if(saved.find(u=>String(u._id)===String(c.id))?.email!==c.email)throw new Error('Verification failed');
 const file=path.resolve(__dirname,'../../audit-tools/techsoftsolutions-setup.json');
 const report=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const u of report.users){const c=changes.find(c=>c.oldEmail===u.email);if(c)u.email=c.email;}
 fs.writeFileSync(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({updated:changes.length,verified:true,examples:changes.slice(0,3).map(c=>c.email)}));
}
main().catch(e=>{console.error(e.name,e.message.replace(/mongodb\S*/g,'[redacted]'));process.exitCode=1}).finally(()=>m.disconnect());
