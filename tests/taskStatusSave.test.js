const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve('../CIIS/src/utils/taskStatusSave.js')).href);
test('status writes retain keepalive and serialize conflicting selections', async () => {
 const {createTaskStatusSaver}=await load();const writes=[];let finish;
 const save=createTaskStatusSaver({patch:async(url,body,config)=>{writes.push({body,config});if(writes.length===1)await new Promise(r=>finish=r);return {data:{success:true}}}});
 const first=save('/task/status',{status:'in-progress'});const second=save('/task/status',{status:'completed'});
 await new Promise(r=>setImmediate(r));assert.equal(writes.length,1);finish();await Promise.all([first,second]);
 assert.deepEqual(writes.map(w=>w.body.status),['in-progress','completed']);assert.equal(writes[0].config.adapter,'fetch');assert.equal(writes[0].config.fetchOptions.keepalive,true);
});
test('failed save does not block a later save or report success',async()=>{
 const {createTaskStatusSaver}=await load();let n=0;const save=createTaskStatusSaver({patch:async()=>({data:++n===1?{success:false,error:'Not saved'}:{success:true}})});
 await assert.rejects(save('/task/status',{}),/Not saved/);assert.equal((await save('/task/status',{})).data.success,true);
});
test('temporary network failure retries the same mutation identity, then releases reads',async()=>{
 const {createTaskStatusSaver}=await load();const ids=[];let attempts=0;
 const save=createTaskStatusSaver({patch:async(url,body)=>{ids.push(body._statusRequestId);if(++attempts===1)throw Object.assign(new Error('connection reset'),{code:'ERR_NETWORK'});return {data:{success:true}}}});
 const writing=save('/task/status',{status:'completed'});await save.whenIdle();await writing;
 assert.equal(attempts,2);assert.equal(ids[0],ids[1]);
});
test('permission failures are not retried',async()=>{
 const {createTaskStatusSaver}=await load();let attempts=0;const save=createTaskStatusSaver({patch:async()=>{attempts++;throw {response:{status:403}}}});
 await assert.rejects(save('/task/status',{}));assert.equal(attempts,1);
});
