const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Client = require('../HR-CDS/models/Client');
const Company = require('../models/Company');
const Conversation = require('../HR-CDS/chat/models/Conversation');
const User = require('../models/User');
const { syncClient, resolveMember } = require('../HR-CDS/utils/clientChatService');

const oid = () => new mongoose.Types.ObjectId();

test('client chat sweep shares company users across clients and reports a missing name once', async t => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  t.after(async () => {
    console.warn = originalWarn;
    await mongoose.disconnect();
    await mongo.stop();
  });

  const companyId = oid();
  await Company.collection.insertOne({ _id: companyId, companyCode: 'TEST01', companyName: 'ZZTEST Co' });
  const manager = oid();
  await User.collection.insertMany([
    { _id: manager, name: 'Active Manager', email: 'zztest-manager@example.com', company: companyId, isActive: true },
    { _id: oid(), name: 'Left Employee', email: 'zztest-left@example.com', company: companyId, isActive: false },
  ]);
  const clientIds = [oid(), oid()];
  await Client.collection.insertMany(clientIds.map((_id, index) => ({
    _id, client: `ZZTEST Client ${index + 1}`, companyCode: 'TEST01', projectManager: ['Active Manager', 'Left Employee'],
  })));

  // Sweeps pass one Map for the whole pass; the second client of the same company used to
  // re-run the cached Query and throw "Query was already executed".
  const usersByCompany = new Map();
  for (let pass = 0; pass < 3; pass += 1) {
    for (const clientId of clientIds) {
      const conversation = await syncClient(clientId, { usersByCompany });
      assert.ok(conversation, 'conversation synced');
      assert.deepEqual(conversation.members.map(String), [String(manager)]);
    }
  }
  assert.equal(await Conversation.countDocuments({ clientId: { $in: clientIds } }), 2);

  const unmatched = warnings.filter(line => line.includes('unmatched member name'));
  assert.equal(unmatched.length, 2, unmatched.join('\n'));
  assert.ok(unmatched.every(line => line.includes('Left Employee')));

  // Access checks resolve against a single candidate; a miss there is not worth a log line.
  assert.equal(resolveMember('Someone Else', [{ _id: manager, name: 'Active Manager' }]), null);
  assert.equal(warnings.filter(line => line.includes('Someone Else')).length, 0);
});
