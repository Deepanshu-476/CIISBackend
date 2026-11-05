const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Client = require('../HR-CDS/models/Client');
const ClientPlan = require('../HR-CDS/models/ClientPlan');
const ClientTask = require('../HR-CDS/models/ClientTask');
const Conversation = require('../HR-CDS/chat/models/Conversation');
const Message = require('../HR-CDS/chat/models/Message');
const Notification = require('../HR-CDS/models/Notification');
const User = require('../models/User');
const clientChatService = require('../HR-CDS/utils/clientChatService');
const { syncExpiredSubscriptionClientTasks } = require('../HR-CDS/controllers/ClientTask').internal;
const clientController = require('../HR-CDS/controllers/clientController');
const { mergeEditedSubscriptions, moveSubscriptionTasksToEndDate } = clientController.internal;
const { endOfIstDay, istDaysUntil, planTaskDueDate, subscriptionExpiresAt } = require('../HR-CDS/utils/subscriptionDates');

const oid = () => new mongoose.Types.ObjectId();
const day = 24 * 60 * 60 * 1000;
const originalSyncClient = clientChatService.syncClient;
let replSet;

test.before(async () => {
  // Renewal runs in a transaction, which needs a replica set.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Build indexes up front: a fresh database builds them on first use, and that blocks transactions.
  await Promise.all([Client, ClientPlan, ClientTask, Conversation, Message, Notification, User].map(model => model.init()));
});
test.after(async () => {
  clientChatService.syncClient = originalSyncClient;
  await mongoose.disconnect();
  await replSet.stop();
});

const call = async (handler, req) => {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res);
  return res;
};

test('subscription dates follow IST calendar days', () => {
  // "3 Nov" stored as UTC midnight or IST midnight both end at 23:59:59.999 IST on 3 Nov.
  const end = new Date('2026-11-03T18:29:59.999Z');
  assert.equal(endOfIstDay('2026-11-03T00:00:00.000Z').getTime(), end.getTime());
  assert.equal(endOfIstDay('2026-11-02T18:30:00.000Z').getTime(), end.getTime());
  const subscription = { startDate: new Date('2026-10-03T00:00:00Z'), endDate: new Date('2026-11-03T00:00:00Z') };
  assert.equal(subscriptionExpiresAt(subscription).getTime(), end.getTime());
  // dueInDays counts from the start, and never runs past the subscription.
  assert.equal(planTaskDueDate(subscription, 0).getTime(), end.getTime());
  assert.equal(planTaskDueDate(subscription, 5).toISOString(), '2026-10-08T18:29:59.999Z');
  assert.equal(planTaskDueDate(subscription, 90).getTime(), end.getTime());
  // The plan form's "whole plan" default (months x 30) ends with the 31-day subscription, not a day early.
  assert.equal(planTaskDueDate(subscription, 30, 1).getTime(), end.getTime());
  assert.equal(planTaskDueDate(subscription, 29, 1).toISOString(), '2026-11-01T18:29:59.999Z');
  // Reminder days: the 9 AM UTC run on 29 Oct is 5 days before a 3 Nov end.
  assert.equal(istDaysUntil('2026-11-03T00:00:00Z', new Date('2026-10-29T09:00:00Z')), 5);
  assert.equal(istDaysUntil('2026-11-03T00:00:00Z', new Date('2026-11-03T17:00:00Z')), 0);
  assert.equal(istDaysUntil('2026-11-03T00:00:00Z', new Date('2026-11-03T18:31:00Z')), -1);
});

test('expiry moves only the ended subscription tasks to overdue and posts one summary', async () => {
  const companyId = oid();
  const members = [oid(), oid()];
  await User.collection.insertMany(members.map((_id, index) => ({ _id, name: `Member ${index + 1}`, email: `zztest-member${index + 1}@example.com`, company: companyId })));
  const clientId = oid();
  const sub1 = oid(), sub2 = oid(), sub3 = oid(), endsToday = oid(), deletedSub = oid();
  const now = Date.now();
  await Client.collection.insertOne({
    _id: clientId, client: 'ZZTEST Client', companyCode: 'TEST01',
    subscription: [
      { _id: sub1, subscriptionNo: 1, startDate: new Date(now - 60 * day), endDate: new Date(now - 30 * day), status: 'Expired' },
      { _id: sub2, subscriptionNo: 2, planName: 'SEO', startDate: new Date(now - 30 * day), endDate: new Date(now - 2 * day), status: 'Active' },
      { _id: sub3, subscriptionNo: 3, startDate: new Date(now), endDate: new Date(now + 30 * day), status: 'Active' },
      { _id: endsToday, subscriptionNo: 4, startDate: new Date(now - 30 * day), endDate: new Date(now), status: 'Active' },
    ],
  });
  const conversation = await Conversation.create({ companyId, clientId, isGroup: true, groupName: 'ZZTEST Client', members });
  clientChatService.syncClient = async () => conversation.toObject();

  const task = (name, extra) => ({ _id: oid(), clientId, name, status: 'pending', completed: false, dueDateSource: 'subscription', activityLogs: [], __v: 0, ...extra });
  const tasks = {
    sub2a: task('Keyword Research Day 9', { subscriptionId: sub2, dueDate: new Date(now - 2 * day) }),
    sub2b: task('SEO Optimization Day 10', { subscriptionId: sub2, dueDate: new Date(now - 2 * day) }),
    sub2Done: task('Done task', { subscriptionId: sub2, status: 'completed', completed: true }),
    sub2Manual: task('Manual date task', { subscriptionId: sub2, dueDateSource: 'manual', dueDate: new Date(now + 5 * day) }),
    sub1Left: task('Old subscription task', { subscriptionId: sub1 }),
    current: task('Current subscription task', { subscriptionId: sub3 }),
    lastDay: task('Task on the last day', { subscriptionId: endsToday }),
    orphan: task('Task of a deleted subscription', { subscriptionId: deletedSub }),
    noSub: task('Task without subscription', {}),
  };
  await ClientTask.collection.insertMany(Object.values(tasks));
  const statusOf = async key => (await ClientTask.collection.findOne({ _id: tasks[key]._id })).status;

  const result = await syncExpiredSubscriptionClientTasks([clientId]);
  assert.equal(result.modifiedCount, 3);
  assert.equal(await statusOf('sub2a'), 'overdue');
  assert.equal(await statusOf('sub2b'), 'overdue');
  assert.equal(await statusOf('sub1Left'), 'overdue');
  for (const key of ['sub2Done', 'sub2Manual', 'current', 'lastDay', 'orphan', 'noSub']) {
    assert.equal(await statusOf(key), key === 'sub2Done' ? 'completed' : 'pending', key);
  }

  // One summary per expired subscription, none per task.
  const messages = await Message.find({ conversationId: conversation._id }).lean();
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.systemEvent.type === 'subscription_expired'));
  const sub2Message = messages.find(message => message.text.startsWith('Subscription 2'));
  assert.match(sub2Message.text, /^Subscription 2 \(SEO\) has expired\. 2 pending tasks moved to Overdue:/);
  assert.match(sub2Message.text, /• Keyword Research Day 9/);
  assert.match(sub2Message.text, /• SEO Optimization Day 10/);
  assert.equal(await Notification.countDocuments({}), 4);
  const notification = await Notification.findOne({ eventKey: sub2Message.eventKey }).lean();
  assert.equal(notification.title, 'Update in ZZTEST Client');
  assert.doesNotMatch(notification.message, /\n/);

  // The sweep runs on every list request; a second run changes and posts nothing.
  const again = await syncExpiredSubscriptionClientTasks([clientId]);
  assert.equal(again.modifiedCount, 0);
  assert.equal(await Message.countDocuments({}), 2);
  assert.equal(await Notification.countDocuments({}), 4);

  // Editing a client sends only the latest subscription back, without its _id.
  const stored = (await Client.findById(clientId).lean()).subscription;
  const newEnd = new Date(now + 10 * day);
  const merged = mergeEditedSubscriptions(stored, [{ startDate: stored[3].startDate, endDate: newEnd, price: 500, status: 'Active' }]);
  assert.deepEqual(merged.map(sub => String(sub._id)), [sub1, sub2, sub3, endsToday].map(String));
  assert.deepEqual(merged.map(sub => sub.subscriptionNo), [1, 2, 3, 4]);
  assert.equal(merged[3].endDate.getTime(), newEnd.getTime());
  assert.equal(merged[3].price, 500);
  assert.equal(merged[1].planName, 'SEO');

  // Extending an expired subscription moves its tasks and opens the ones that expired with it.
  await moveSubscriptionTasksToEndDate({ clientId, subscriptionId: sub2, subscriptionNo: 2, previousEndDate: stored[1].endDate, endDate: newEnd });
  const reopened = await ClientTask.collection.findOne({ _id: tasks.sub2a._id });
  assert.equal(reopened.status, 'pending');
  assert.equal(reopened.dueDate.getTime(), endOfIstDay(newEnd).getTime());
  const manual = await ClientTask.collection.findOne({ _id: tasks.sub2Manual._id });
  assert.equal(manual.dueDate.getTime(), tasks.sub2Manual.dueDate.getTime());
  assert.equal(await statusOf('sub1Left'), 'overdue');
});

test('every new subscription gets a number and its own plan tasks; remove takes only the latest', async () => {
  const companyId = oid();
  const members = [oid(), oid()];
  await User.collection.insertMany(members.map((_id, index) => ({ _id, name: `Plan Member ${index + 1}`, email: `zztest-plan${index + 1}@example.com`, company: companyId })));
  const plan = await ClientPlan.create({
    companyCode: 'TEST01', name: 'ZZTEST Plan', price: 1000, months: 1,
    services: [
      { service: 'SEO', tasks: [{ name: 'Audit' }, { name: 'Report Day 5', dueInDays: 5 }] },
      { service: 'Ads', tasks: [{ name: 'Campaign' }] },
    ],
  });
  const clientId = oid();
  const firstSub = oid();
  const receiptId = oid();
  const start = new Date('2026-09-03T00:00:00Z');
  await Client.collection.insertOne({
    _id: clientId, client: 'ZZTEST Plan Client', company: 'ZZTEST Co', city: 'Test', companyCode: 'TEST01',
    projectManager: ['Manager'], status: 'Active', activeClientPlan: plan._id,
    subscription: [{ _id: firstSub, subscriptionNo: 1, planId: plan._id, startDate: start, endDate: new Date('2026-10-03T00:00:00Z'), status: 'Expired' }],
    paymentReceipts: [{ _id: receiptId, amount: 750, status: 'Pending' }],
  });
  const tasksOf = subscriptionId => ClientTask.find({ subscriptionId }).lean();
  const conversation = await Conversation.create({ companyId, clientId, isGroup: true, groupName: 'ZZTEST Plan Client', members });
  clientChatService.syncClient = async () => conversation.toObject();
  // The summary is posted after the response; wait for it.
  const planMessages = async expected => {
    for (let i = 0; i < 50; i += 1) {
      const found = await Message.find({ conversationId: conversation._id }).lean();
      if (found.length >= expected) return found;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return Message.find({ conversationId: conversation._id }).lean();
  };

  // Extend: no plan in the request, so the client's active plan is used.
  const extended = await call(clientController.extendClientSubscription, { params: { id: String(clientId) }, body: { days: 30, price: 100 } });
  assert.equal(extended.code, 200, JSON.stringify(extended.body));
  let client = await Client.findById(clientId).lean();
  const sub2 = client.subscription[1];
  assert.equal(sub2.subscriptionNo, 2);
  assert.equal(String(sub2.planId), String(plan._id));
  assert.equal(sub2.price, 100);
  const sub2Tasks = await tasksOf(sub2._id);
  assert.deepEqual(sub2Tasks.map(task => task.name).sort(), ['Audit', 'Campaign', 'Report Day 5']);
  assert.equal(sub2Tasks.find(task => task.name === 'Audit').dueDate.getTime(), subscriptionExpiresAt(sub2).getTime());
  assert.equal(sub2Tasks.find(task => task.name === 'Report Day 5').dueDate.getTime(), planTaskDueDate(sub2, 5).getTime());

  // One summary for the whole plan, not a "created task" message per task.
  let messages = await planMessages(1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].systemEvent.type, 'plan_tasks_created');
  assert.match(messages[0].text, /^Subscription 2 \(ZZTEST Plan\) started\. 3 tasks created from the plan:\n• /);
  let notified = 0;
  for (let i = 0; i < 50 && notified < 2; i += 1) {
    notified = await Notification.countDocuments({ 'data.messageId': messages[0]._id });
    if (notified < 2) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(notified, 2);

  // Payment approval activates a subscription the same way.
  const approved = await call(clientController.updateClientReceiptStatus, {
    params: { id: String(clientId), receiptId: String(receiptId) },
    body: { status: 'Approved', startDate: '2026-12-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z' },
  });
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  client = await Client.findById(clientId).lean();
  const sub3 = client.subscription[2];
  assert.equal(sub3.subscriptionNo, 3);
  assert.equal(sub3.price, 750);
  assert.equal((await tasksOf(sub3._id)).length, 3);

  // Remove takes only the latest: its open tasks go, completed work and older subscriptions stay.
  await ClientTask.collection.updateOne({ subscriptionId: sub3._id, name: 'Audit' }, { $set: { status: 'completed', completed: true } });
  const removed = await call(clientController.removeClientSubscription, { params: { id: String(clientId) } });
  assert.equal(removed.code, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.removedTasks, 2);
  client = await Client.findById(clientId).lean();
  assert.deepEqual(client.subscription.map(sub => sub.subscriptionNo), [1, 2]);
  assert.deepEqual((await tasksOf(sub3._id)).map(task => task.name), ['Audit']);
  assert.equal((await tasksOf(sub2._id)).length, 3);

  // Renewal numbers after the highest one and generates its own tasks.
  const renewed = await call(clientController.renewClientSubscription, {
    params: { id: String(clientId) },
    body: { startDate: '2027-01-01T00:00:00Z', endDate: '2027-01-31T00:00:00Z', clientPlanId: String(plan._id) },
  });
  assert.equal(renewed.code, 200, JSON.stringify(renewed.body));
  client = await Client.findById(clientId).lean();
  const renewedSub = client.subscription.at(-1);
  assert.equal(renewedSub.subscriptionNo, 3);
  assert.equal((await tasksOf(renewedSub._id)).length, 3);
  messages = await planMessages(3);
  assert.equal(messages.length, 3);
  assert.ok(messages.every(message => message.systemEvent.type === 'plan_tasks_created'));
  // Older subscriptions' tasks are not carried into the renewal.
  assert.equal((await tasksOf(sub2._id)).every(task => task.dueDate.getTime() <= subscriptionExpiresAt(sub2).getTime()), true);
});
