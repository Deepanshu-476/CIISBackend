require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Conversation = require('../HR-CDS/chat/models/Conversation');
const Message = require('../HR-CDS/chat/models/Message');
const { syncClient } = require('../HR-CDS/utils/clientChatService');
const { syncProject } = require('../HR-CDS/utils/projectChatService');
const { Project } = require('../HR-CDS/models/Project');

async function main() {
  const isApply = process.argv.includes('--apply');
  const isDelete = process.argv.includes('--delete'); // default is move
  const convertNonMembers = process.argv.includes('--convert-non-members');

  console.log(`\n=== CHAT MISROUTED EVENTS FIX SCRIPT ===`);
  console.log(`Mode: ${isApply ? 'APPLY (modifying DB)' : 'DRY RUN (read-only preview)'}`);
  console.log(`Action for misrouted: ${isDelete ? 'DELETE' : 'MOVE to correct client conversation'}\n`);

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in environment');
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const db = mongoose.connection.db;

  // 1. Check for conversations with both projectId and clientId
  const dualConversations = await Conversation.find({
    projectId: { $type: 'objectId' },
    clientId: { $type: 'objectId' },
  }).lean();

  console.log(`1. Conversations with BOTH projectId and clientId: ${dualConversations.length}`);
  for (const c of dualConversations) {
    console.log(`   - ID: ${c._id}, Name: "${c.groupName}", projectId: ${c.projectId}, clientId: ${c.clientId}`);
  }

  // 2. Scan for misrouted client messages
  const clientMessagesCursor = Message.find({ 'systemEvent.client': { $exists: true } }).lean().cursor();
  const misroutedClientByConv = new Map();
  const misroutedMessages = [];

  for await (const msg of clientMessagesCursor) {
    const conv = await Conversation.findById(msg.conversationId).select('_id clientId projectId groupName').lean();
    if (!conv || String(conv.clientId) !== String(msg.systemEvent.client)) {
      misroutedMessages.push({ msg, currentConv: conv });
      const convKey = conv ? `${conv._id} ("${conv.groupName}")` : 'Orphan (no conversation)';
      misroutedClientByConv.set(convKey, (misroutedClientByConv.get(convKey) || 0) + 1);
    }
  }

  console.log(`\n2. Misrouted client-task messages found: ${misroutedMessages.length}`);
  for (const [convName, count] of misroutedClientByConv.entries()) {
    console.log(`   - Conversation ${convName}: ${count} misrouted messages`);
  }

  // 3. Scan for misrouted project messages
  const projectMessagesCursor = Message.find({ 'systemEvent.project': { $exists: true } }).lean().cursor();
  const misroutedProjectMessages = [];

  for await (const msg of projectMessagesCursor) {
    const conv = await Conversation.findById(msg.conversationId).select('_id clientId projectId groupName').lean();
    if (!conv || String(conv.projectId) !== String(msg.systemEvent.project)) {
      misroutedProjectMessages.push({ msg, currentConv: conv });
    }
  }

  console.log(`\n3. Misrouted project-task messages found: ${misroutedProjectMessages.length}`);

  // 4. Scan for non-member user status messages (messageType: 'message' with systemEvent.task)
  const taskStatusMessages = await Message.find({
    messageType: 'message',
    'systemEvent.task': { $exists: true },
  }).select('_id conversationId sender text').lean();

  const nonMemberMessages = [];
  const convMembersCache = new Map();

  for (const msg of taskStatusMessages) {
    let members = convMembersCache.get(String(msg.conversationId));
    if (!members) {
      const c = await Conversation.findById(msg.conversationId).select('members').lean();
      members = new Set((c?.members || []).map(String));
      convMembersCache.set(String(msg.conversationId), members);
    }
    if (!members.has(String(msg.sender))) {
      nonMemberMessages.push(msg);
    }
  }

  console.log(`\n4. Status messages posted as user chat bubbles by non-members: ${nonMemberMessages.length}`);

  // Execution if --apply is set
  if (isApply) {
    console.log(`\n--- Applying changes ---`);

    // Handle misrouted client messages
    let movedCount = 0;
    let deletedCount = 0;

    for (const { msg } of misroutedMessages) {
      if (isDelete) {
        await Message.deleteOne({ _id: msg._id });
        deletedCount++;
      } else {
        // Move: find or sync target client conversation
        let targetConv = await Conversation.findOne({
          clientId: msg.systemEvent.client,
          projectId: { $exists: false },
        });

        if (!targetConv) {
          targetConv = await syncClient(msg.systemEvent.client);
        }

        if (targetConv) {
          await Message.updateOne(
            { _id: msg._id },
            { $set: { conversationId: targetConv._id, companyId: targetConv.companyId } }
          );
          movedCount++;
        } else {
          console.warn(`   Could not resolve client conversation for client ${msg.systemEvent.client}; skipped msg ${msg._id}`);
        }
      }
    }

    if (isDelete) {
      console.log(`Deleted ${deletedCount} misrouted client messages.`);
    } else {
      console.log(`Moved ${movedCount} misrouted client messages to their respective client conversations.`);
    }

    // Convert non-member messages if requested
    if (convertNonMembers && nonMemberMessages.length) {
      const nonMemberIds = nonMemberMessages.map(m => m._id);
      const res = await Message.updateMany(
        { _id: { $in: nonMemberIds } },
        { $set: { messageType: 'system' } }
      );
      console.log(`Converted ${res.modifiedCount} non-member messages to messageType: 'system'.`);
    }

    console.log(`\nCleanup complete.`);
  } else {
    console.log(`\nDRY RUN complete. No changes were made to the database.`);
    console.log(`To apply changes, run with: node scripts/fixMisroutedChatEvents.js --apply`);
    if (nonMemberMessages.length) {
      console.log(`To also convert non-member messages to system cards, add: --convert-non-members`);
    }
  }
}

main()
  .catch(err => {
    console.error('Script error:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
