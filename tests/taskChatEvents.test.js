const test = require('node:test');
const assert = require('node:assert/strict');
const { diffEvents } = require('../HR-CDS/utils/projectChatEvents');
const { taskEvents } = require('../HR-CDS/utils/clientChatPlugin');

const oid = n => String(n).padStart(24, '0');
const actor = oid(1), alice = oid(2), bob = oid(3);
const base = {
  _id: oid(10), title: 'Landing page', description: 'Build it', priority: 'medium', status: 'pending',
  assignedTo: alice, assignedUsers: [], dueDate: '2026-10-26T10:00:00.000Z',
  checkpoints: [{ _id: oid(20), title: 'Design', completed: false }], remarks: [], activityLogs: [],
};
const project = tasks => ({ _id: oid(99), __v: 1, createdBy: actor, tasks });
const types = events => events.map(event => event.type).sort();

test('every task field change on an existing project task becomes a chat event', () => {
  const after = {
    ...base, title: 'Landing page v2', description: 'Build it fast', priority: 'high', status: 'in progress',
    assignedTo: bob, dueDate: '2026-10-28T10:00:00.000Z',
    checkpoints: [{ ...base.checkpoints[0], completed: true, completedBy: bob }, { _id: oid(21), title: 'QA', completed: false }],
    pdfFile: { path: 'uploads/brief.pdf', originalName: 'brief.pdf' },
    remarks: [{ _id: oid(30), text: 'Ping @[Bob](' + bob + ') please', createdBy: alice, images: [{}] }],
  };
  const events = diffEvents(project([base]), project([after]), actor);
  assert.deepEqual(types(events), [
    'task_assignee_changed', 'task_checkpoint_added', 'task_checkpoint_completed', 'task_description_updated',
    'task_due_changed', 'task_file_added', 'task_mentioned', 'task_priority_changed', 'task_remark_added',
    'task_renamed', 'task_status_changed',
  ]);
  const byType = Object.fromEntries(events.map(event => [event.type, event]));
  assert.equal(byType.task_remark_added.remark, 'Ping @Bob please');
  assert.equal(byType.task_remark_added.images, 1);
  assert.equal(byType.task_remark_added.actor, alice);
  assert.equal(byType.task_checkpoint_completed.actor, bob);
  assert.deepEqual(byType.task_assignee_changed.assigned, [bob]);
  assert.equal(byType.task_priority_changed.to, 'High');
  assert.equal(byType.task_renamed.from, 'Landing page');
  assert.equal(new Set(events.map(event => event.key)).size, events.length);
});

test('unchanged tasks produce no events and removed tasks produce a delete event', () => {
  assert.deepEqual(diffEvents(project([base]), project([{ ...base }]), actor), []);
  const events = diffEvents(project([base]), project([]), actor);
  assert.deepEqual(types(events), ['task_deleted']);
  assert.equal(events[0].title, 'Landing page');
});

test('repeating the same change on a later revision gets a new event key', () => {
  const high = { ...base, priority: 'high' };
  const first = diffEvents(project([base]), project([high]), actor);
  const again = diffEvents({ ...project([base]), __v: 3 }, project([high]), actor);
  assert.notEqual(first[0].key, again[0].key);
});

test('client tasks map name, assignee, files and checkpoint reopen into chat events', () => {
  const before = {
    _id: oid(40), clientId: oid(98), __v: 2, name: 'SEO audit', assignee: 'Alice', assigneeId: null, priority: 'Medium',
    status: 'pending', files: [{ _id: oid(50), originalName: 'old.pdf' }],
    checkpoints: [{ _id: oid(60), title: 'Keywords', completed: true }], remarks: [], activityLogs: [],
  };
  const after = {
    ...before, name: 'SEO audit Q4', assignee: 'Bob', files: [{ _id: oid(51), originalName: 'new.pdf' }],
    checkpoints: [{ ...before.checkpoints[0], completed: false }],
    remarks: [{ _id: oid(70), text: 'Done with draft', user: actor }],
  };
  const events = taskEvents(before, after);
  assert.deepEqual(types(events), [
    'task_assignee_changed', 'task_checkpoint_reopened', 'task_file_added', 'task_file_removed', 'task_remark_added', 'task_renamed',
  ]);
  assert.equal(events.find(event => event.type === 'task_assignee_changed').assigneeName, 'Bob');
  assert.equal(events.find(event => event.type === 'task_file_removed').file, 'old.pdf');
});

test('a remark given with a status change is part of the status event, not a separate card', () => {
  const remark = { _id: oid(40), text: 'Waiting for client documents', createdBy: actor, image: 'remarks/r1.jpg', statusChange: 'on hold' };
  const events = diffEvents(project([base]), project([{ ...base, status: 'on hold', remarks: [remark] }]), actor);
  assert.deepEqual(types(events), ['task_status_changed']);
  assert.equal(events[0].remark, 'Waiting for client documents');
  assert.equal(events[0].image, '/uploads/remarks/r1.jpg');
  assert.equal(events[0].to, 'On Hold');
});

test('project status remark pushed on its own (status set in the same write) adds no remark card', () => {
  const remark = { _id: oid(41), text: 'Image attachment', createdBy: actor, image: 'remarks/r2.jpg', statusChange: 'completed' };
  assert.deepEqual(diffEvents(project([base]), project([{ ...base, remarks: [remark] }]), actor), []);
});

test('client status change carries service, remark and remark image', () => {
  const before = { _id: oid(50), clientId: oid(51), name: 'GST return', service: 'GST Filing', status: 'pending', completed: false, remarks: [], activityLogs: [], __v: 2 };
  const after = { ...before, status: 'completed', completed: true, remarks: [{ _id: oid(52), text: 'Filed today', images: [{ url: '/uploads/client-remarks/x.jpg' }], user: actor, statusChange: 'completed' }] };
  const events = taskEvents(before, after);
  assert.deepEqual(types(events), ['task_status_changed']);
  assert.equal(events[0].service, 'GST Filing');
  assert.equal(events[0].remark, 'Filed today');
  assert.equal(events[0].image, '/uploads/client-remarks/x.jpg');
});
