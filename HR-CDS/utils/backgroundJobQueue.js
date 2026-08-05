const queue = [];
let running = false;

const runNext = () => {
  if (running) return;
  const nextJob = queue.shift();
  if (!nextJob) return;

  running = true;
  Promise.resolve()
    .then(nextJob)
    .catch(err => {
      console.error('❌ Background job failed:', err);
    })
    .finally(() => {
      running = false;
      if (queue.length > 0) {
        setImmediate(runNext);
      }
    });
};

const enqueueBackgroundJob = (job) => {
  if (typeof job !== 'function') return;
  queue.push(job);
  setImmediate(runNext);
};

const enqueueCompletionJob = (job) => enqueueBackgroundJob(job);

module.exports = {
  enqueueBackgroundJob,
  enqueueCompletionJob
};
