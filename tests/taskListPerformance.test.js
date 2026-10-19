const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('HR-CDS/controllers/taskController.js','utf8');
for(const [name,next] of [['fetchPersonalTaskList','fetchAssignedToMeTaskList'],['fetchAssignedToMeTaskList','getAdminTaskPageScope']]){
 test(name+' preserves selection and status without full-history hydration',async()=>{
  const calls=[];const docs=Array.from({length:2000},(_,i)=>({_id:'task'+i,overallStatus:'pending',statusByUser:[{user:'u1',status:'completed'}],assignedUsers:['u1']}));
  const query={select(){return this},populate(){calls.push('populate');return this},sort(){return this},lean:async()=>docs};
  const context={TASK_USER_POPULATE_FIELDS:'name',TASK_GROUP_POPULATE_FIELDS:'name',TASK_CREATOR_POPULATE_FIELDS:'name',Task:{find:q=>{calls.push(JSON.stringify(q));return query}},Group:{find:()=>({select:()=>({lean:async()=>[]})})},enrichStatusInfo:async t=>{calls.push('enrich');return t},normalizeTaskStatus:s=>s};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const '+name+' ='),source.indexOf('const '+next+' ='))+'\nthis.load='+name,context);
  const req={user:{_id:'u1',id:'u1',companyCode:'CAREER-1'}};
  const full=await context.load(req);const fullQuery=calls[0];calls.length=0;
  const lite=await context.load(req,{lightweight:true});
  assert.equal(JSON.stringify(full),JSON.stringify(lite));assert.equal(calls[0],fullQuery);assert.equal(calls.length,1);
 });
}
test('client candidates retain names and selection without populating every client task',async()=>{
 const calls=[];const docs=Array.from({length:2000},(_,i)=>({_id:'c'+i,clientId:'client1',name:'Task '+i,status:'pending',priority:'High'}));
 const query={select(){return this},populate(){calls.push('populate');return this},sort(){return this},lean:async()=>docs};
 const ctx={Client:{find:()=>({select:()=>({lean:async()=>[{_id:'client1',client:'Acme'}]})})},ClientTask:{find:q=>{calls.push(JSON.stringify(q));return query}},getRequestCompanyCode:()=> 'CAREER',normalizeTaskStatus:s=>s,isTaskOverdueForStatus:()=>false};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const fetchAssignedClientTaskList ='),source.indexOf('const normalizeProjectTaskStatus'))+'\nthis.load=fetchAssignedClientTaskList',ctx);
 const req={user:{_id:'u1',name:'User'}};const full=await ctx.load(req);const filter=calls[0];calls.length=0;const lite=await ctx.load(req,{lightweight:true});
 assert.equal(JSON.stringify(full),JSON.stringify(lite));assert.equal(calls[0],filter);assert.equal(calls.length,1);assert.equal(lite[0].clientName,'Acme');
});
