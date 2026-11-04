const { createHash } = require('node:crypto');

const SYSTEM_USER_ID = '000000000000000000000001';
const LISTED_TASKS = 15;

// One group message (and one notification per member) for something that happened to a whole
// subscription's tasks at once, such as its plan tasks being created or it expiring, instead of
// one message per task. The key makes it once per subscription and type.
async function postSubscriptionTasksMessage(type, clientId, subscription, tasks = []) {
  if (!clientId || !subscription?._id || !tasks.length) return;
  const { syncClient } = require('./clientChatService');
  const { deliverEvent } = require('./projectChatService');
  const conversation = await syncClient(clientId);
  if (!conversation?.members?.length) return;
  await deliverEvent({ _id: clientId, chatEntity: 'client' }, conversation, {
    key: createHash('sha256').update(`${clientId}:${subscription._id}:${type}`).digest('hex'),
    type,
    actor: SYSTEM_USER_ID,
    subscriptionNo: subscription.subscriptionNo || null,
    planName: subscription.planName || '',
    count: tasks.length,
    titles: tasks.slice(0, LISTED_TASKS).map(task => task.name || 'Untitled task')
  });
}

module.exports = { postSubscriptionTasksMessage, SYSTEM_USER_ID };
