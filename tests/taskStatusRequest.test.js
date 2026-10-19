const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const middleware=require('../middleware/taskStatusRequest');
function request(actor,id,status='completed'){
 const req={user:{_id:actor},originalUrl:'/api/tasks/self/task/status',body:{_statusRequestId:id,status}};
 const res=new EventEmitter();res.statusCode=200;res.status=n=>{res.statusCode=n;return res};
 let resolve;const done=new Promise(r=>resolve=r);res.json=body=>{resolve({status:res.statusCode,body});return res};
 return {req,res,done};
}
test('same actor/request retry runs mutation once and returns saved result',async()=>{
 const a=request('a','one'),b=request('a','one');let writes=0;
 middleware(a.req,a.res,()=>{writes++});const waiting=middleware(b.req,b.res,()=>{writes++});
 a.res.json({success:true,data:{newStatus:'completed'}});await waiting;
 assert.equal(writes,1);assert.deepEqual(await a.done,await b.done);
});
test('request identities are isolated per account and reject changed payloads',async()=>{
 const a=request('a','two');middleware(a.req,a.res,()=>{});a.res.json({success:true});
 const conflict=request('a','two','pending');middleware(conflict.req,conflict.res,()=>assert.fail());assert.equal((await conflict.done).status,409);
 const other=request('b','two');let called=false;middleware(other.req,other.res,()=>{called=true;other.res.json({success:true})});assert.equal(called,true);
});
