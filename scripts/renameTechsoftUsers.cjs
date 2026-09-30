require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const firstNames = 'Aarav,Diya,Arjun,Ananya,Rohan,Ishita,Vivaan,Kavya,Aditya,Meera,Kabir,Aditi,Reyansh,Naina,Vihaan,Saanvi,Dev,Avni,Dhruv,Riya,Krish,Priya,Neil,Tara,Yash,Sneha,Harsh,Pooja,Kunal,Neha,Rahul,Simran,Rohit,Sakshi,Aman,Shreya,Nikhil,Anjali,Varun,Divya,Siddharth,Muskan,Akash,Palak,Manav,Swati,Pranav,Tanvi,Rajat,Kritika,Abhinav,Shivani,Gaurav,Shruti,Mayank,Anushka,Chirag,Ritika,Ankit,Sonali,Deepak,Mansi,Tushar,Preeti,Utkarsh,Bhavna,Sahil,Ira'.split(',');
const surnames = ['Sharma','Verma','Mehta','Kapoor','Malhotra','Joshi','Bansal','Saxena','Khanna','Chauhan','Sethi','Arora'];
async function main() {
  await mongoose.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});
  const db=mongoose.connection.db;
  const company=await db.collection('companies').findOne({companyCode:'TECHSOFT',companyName:'techsoftsolutions'});
  if(!company) throw new Error('Target company not found');
  const users=await db.collection('users').find({company:company._id}).sort({employeeId:1}).toArray();
  const changes=users.filter(u=>/^Test User \d+$/.test(u.name)).map(u=>{
    const index=Number(u.name.match(/\d+$/)[0])-1;
    if(!firstNames[index]) throw new Error('Missing name');
    return {id:u._id,email:u.email,oldName:u.name,name:`${firstNames[index]} ${surnames[index%surnames.length]}`};
  });
  const session=await mongoose.startSession();
  try {
    await session.withTransaction(async()=>{
      for(const c of changes){
        const result=await db.collection('users').updateOne({_id:c.id,company:company._id,name:c.oldName},{$set:{name:c.name,updatedAt:new Date()}},{session});
        if(result.matchedCount!==1) throw new Error('User changed during rename');
        await db.collection('departments').updateMany({company:company._id,supportHead:c.id},{$set:{supportHeadName:c.name}},{session});
        await db.collection('pagedatavisibilities').updateMany({company:company._id,subjectType:'user',subjectKey:String(c.id)},{$set:{subjectLabel:c.name}},{session});
      }
    });
  } finally {await session.endSession();}
  const saved=await db.collection('users').find({company:company._id},{projection:{name:1,email:1}}).toArray();
  for(const c of changes) if(saved.find(u=>String(u._id)===String(c.id))?.name!==c.name) throw new Error('Rename verification failed');
  const reportPath=path.resolve(__dirname,'../../audit-tools/techsoftsolutions-setup.json');
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  for(const u of report.users) u.name=saved.find(s=>s.email===u.email)?.name||u.name;
  report.userNamesUpdatedAt=new Date().toISOString();
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({renamed:changes.length,totalUsers:saved.length,examples:changes.slice(0,5).map(c=>c.name),remainingGenericNames:saved.filter(u=>/^Test User \d+$/.test(u.name)).length}));
}
main().catch(e=>{console.error(e.name,e.message.replace(/mongodb\S*/g,'[redacted]'));process.exitCode=1}).finally(()=>mongoose.disconnect());
