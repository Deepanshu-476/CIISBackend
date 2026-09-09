const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  getNextRecurringDate,
  normalizeRepeatPattern,
  normalizeRepeatDays,
  buildRecurringTaskClone,
} = require("../HR-CDS/utils/taskRecurrence");

test("normalizeRepeatPattern normalizes valid patterns", () => {
  assert.equal(normalizeRepeatPattern("daily"), "daily");
  assert.equal(normalizeRepeatPattern("DAILY"), "daily");
  assert.equal(normalizeRepeatPattern("Daily"), "daily");
  assert.equal(normalizeRepeatPattern("none"), "none");
  assert.equal(normalizeRepeatPattern("no"), "none");
  assert.equal(normalizeRepeatPattern(""), "none");
  assert.equal(normalizeRepeatPattern(null), "none");
});

test("normalizeRepeatDays normalizes array and json strings", () => {
  assert.deepEqual(normalizeRepeatDays(["Monday", "FRIDAY"]), ["monday", "friday"]);
  assert.deepEqual(normalizeRepeatDays('["monday", "tuesday"]'), ["monday", "tuesday"]);
  assert.deepEqual(normalizeRepeatDays("monday, wednesday"), ["monday", "wednesday"]);
  assert.deepEqual(normalizeRepeatDays([]), []);
});

test("getNextRecurringDate advances daily correctly", () => {
  const base = new Date("2026-09-09T18:00:00.000Z");
  const next = getNextRecurringDate(base, "daily", []);
  assert.ok(next);
  assert.ok(next > base);
  // Next occurrence should be 1 day ahead (24h)
  const diffHours = (next.getTime() - base.getTime()) / (1000 * 60 * 60);
  assert.equal(diffHours, 24);
});

test("buildRecurringTaskClone preserves occurrence date and sets createdAt", () => {
  const templateId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const templateTask = {
    _id: templateId,
    title: "Daily Standup",
    description: "Team meeting",
    startDateTime: new Date("2026-09-09T04:30:00.000Z"),
    dueDateTime: new Date("2026-09-09T13:30:00.000Z"),
    isRecurring: true,
    repeatPattern: "daily",
    repeatDays: [],
    recurrenceEndDate: new Date("2026-09-15T18:29:59.999Z"),
    companyCode: "CIIS",
    createdBy: userId,
    assignedUsers: [userId],
    checkpoints: [{ title: "Point 1", completed: true }, { title: "Point 2", completed: false }],
  };

  const occurrenceDate = new Date("2026-09-10T13:30:00.000Z");
  const clone = buildRecurringTaskClone(templateTask, occurrenceDate);

  assert.ok(clone);
  assert.equal(clone.title, "Daily Standup");
  assert.equal(clone.taskFor, "self");
  assert.equal(clone.recurrenceSourceId.toString(), templateId.toString());
  assert.equal(clone.dueDateTime.toISOString(), occurrenceDate.toISOString());
  assert.equal(clone.createdAt.toISOString(), clone.startDateTime ? clone.startDateTime.toISOString() : occurrenceDate.toISOString());
  assert.equal(clone.recurrenceOccurrenceKey, occurrenceDate.toISOString());
  assert.equal(clone.checkpoints.length, 2);
  assert.equal(clone.checkpoints[0].completed, false, "Checkpoints must be reset to pending");
  assert.equal(clone.checkpoints[1].completed, false);
});

test("generateRecurringOccurrences creates all daily occurrences up to recurrenceEndDate", async () => {
  const Task = require("../HR-CDS/models/Task");
  const { generateRecurringOccurrences } = require("../HR-CDS/cron/recurringTasks");

  const createdTasks = [];
  const updatedDocs = [];

  const origFindOne = Task.findOne;
  const origCreate = Task.create;
  const origUpdateOne = Task.updateOne;

  // Mock Task.findOne to return null (no existing clone)
  Task.findOne = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });

  // Mock Task.create
  Task.create = async (payload) => {
    createdTasks.push(payload);
    return { _id: new mongoose.Types.ObjectId(), ...payload };
  };

  // Mock Task.updateOne
  Task.updateOne = async (query, update) => {
    updatedDocs.push({ query, update });
    return { acknowledged: true };
  };

  try {
    const templateId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    // Template for Sept 9, recurrenceEndDate Sept 12
    // Occurrences expected: Sept 10, Sept 11, Sept 12 (3 occurrences)
    const templateTask = {
      _id: templateId,
      title: "Daily Report",
      startDateTime: new Date("2026-09-09T04:30:00.000Z"),
      dueDateTime: new Date("2026-09-09T13:30:00.000Z"),
      isRecurring: true,
      repeatPattern: "daily",
      repeatDays: [],
      recurrenceEndDate: new Date("2026-09-12T18:29:59.999Z"),
      companyCode: "CIIS",
      createdBy: userId,
      assignedUsers: [userId],
    };

    const result = await generateRecurringOccurrences(templateTask);

    assert.equal(result.created, 3, "Should create exactly 3 daily occurrences (Sept 10, 11, 12)");
    assert.equal(createdTasks.length, 3);
    assert.equal(createdTasks[0].dueDateTime.toISOString(), "2026-09-10T13:30:00.000Z");
    assert.equal(createdTasks[1].dueDateTime.toISOString(), "2026-09-11T13:30:00.000Z");
    assert.equal(createdTasks[2].dueDateTime.toISOString(), "2026-09-12T13:30:00.000Z");
  } finally {
    Task.findOne = origFindOne;
    Task.create = origCreate;
    Task.updateOne = origUpdateOne;
    await mongoose.disconnect();
  }
});

