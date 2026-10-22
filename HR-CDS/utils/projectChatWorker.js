const { Project } = require('../models/Project');
const { syncAndDrain } = require('./projectChatService');

async function sweep() {
  await require('./clientChatService').sweep();
  for await (const project of Project.find({ $or: [{ 'chatOutbox.0': { $exists: true } }, { chatSyncPending: true }] }).select('_id').lean().cursor()) {
    try { await syncAndDrain(project._id); }
    catch (error) { console.error('[project-chat] retry failed', String(project._id), error.message); }
  }
}

exports.start = () => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await sweep(); } catch (error) { console.error('[project-chat] sweep failed', error.message); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 30000);
  timer.unref();
  return timer;
};
exports.sweep = sweep;
