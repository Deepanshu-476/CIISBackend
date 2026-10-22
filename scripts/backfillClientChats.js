require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('../HR-CDS/models/Client');
const { syncClient, companyFor, sweep } = require('../HR-CDS/utils/clientChatService');
const Conversation = require('../HR-CDS/chat/models/Conversation');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  if (apply) for (const model of [Conversation, require('../HR-CDS/chat/models/Message'), require('../HR-CDS/models/Notification')]) await model.createIndexes();
  const result = { mode: apply ? 'apply' : 'dry-run', scanned: 0, existing: 0, missing: 0, synchronized: 0, failed: 0 };
  for await (const client of Client.find({}).select('_id companyCode').lean().cursor()) {
    result.scanned++;
    try {
      const company = await companyFor(client);
      if (!company) throw new Error('Unresolvable companyCode');
      if (await Conversation.exists({ companyId: company._id, clientId: client._id })) result.existing++; else result.missing++;
      if (apply) { await syncClient(client._id); result.synchronized++; }
    } catch (error) { result.failed++; console.error(String(client._id), error.message); }
  }
  if (apply) await sweep();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
