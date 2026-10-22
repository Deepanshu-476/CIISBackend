require('dotenv').config();
const mongoose = require('mongoose');
const { Project } = require('../HR-CDS/models/Project');
const Conversation = require('../HR-CDS/chat/models/Conversation');
const Message = require('../HR-CDS/chat/models/Message');
const Notification = require('../HR-CDS/models/Notification');
const { syncAndDrain, resolveCompany } = require('../HR-CDS/utils/projectChatService');

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  // createIndexes adds only missing indexes; never drops existing indexes or data.
  if (apply) for (const model of [Conversation, Message, Notification]) await model.createIndexes();
  let scanned = 0, synchronized = 0, failed = 0, missing = 0, existing = 0;
  for await (const project of Project.find({}).select('_id projectName company companyCode').lean().cursor()) {
    scanned++;
    if (!apply) {
      const companyId = await resolveCompany(project);
      if (!companyId) { failed++; console.error('Unresolvable company', String(project._id)); continue; }
      if (await Conversation.exists({ projectId: project._id, companyId })) existing++; else missing++;
      continue;
    }
    try { await syncAndDrain(project._id); synchronized++; }
    catch (error) { failed++; console.error('Skipped project', String(project._id), error.message); }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned, synchronized, missing, existing, failed }));
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
