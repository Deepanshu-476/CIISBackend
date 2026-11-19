const CHECKPOINT_LOCKED_MESSAGE = 'Checkpoints can only be updated while the task is In Progress.';
const CHECKPOINT_CONFLICT_MESSAGE = 'The task changed while saving the checkpoint. Refresh and try again.';

const isCheckpointStatus = status =>
  /^in[\s_-]*progress$/i.test(String(status || '').trim());

const isCheckpointWriteConflict = error =>
  ['DocumentNotFoundError', 'VersionError'].includes(error.name);

// Task edits change the checklist structure. Preserve the saved progress of entries that remain.
const preserveCheckpointProgress = (saved, edited) => {
  const remaining = new Set(saved || []);
  const byId = new Map([...remaining].map(checkpoint => [String(checkpoint._id), checkpoint]));
  return edited.map(({ _id, title }) => {
    const checkpoint = _id
      ? byId.get(String(_id))
      : [...remaining].find(item => item.title === title);
    const keep = remaining.delete(checkpoint);
    return {
      title,
      ...(keep ? { _id: checkpoint._id } : {}),
      completed: Boolean(keep && checkpoint.completed),
      completedAt: (keep && checkpoint.completedAt) || null,
      completedBy: (keep && checkpoint.completedBy) || null,
    };
  });
};

module.exports = {
  CHECKPOINT_LOCKED_MESSAGE,
  CHECKPOINT_CONFLICT_MESSAGE,
  isCheckpointStatus,
  isCheckpointWriteConflict,
  preserveCheckpointProgress,
};
