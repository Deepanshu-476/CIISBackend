/**
 * The break flow through the controller: the policy an employee ends up with, starting and ending a
 * break, how it adds up, what the admin is told, and the settings an admin may change.
 *
 * Needs a throwaway mongod (nothing here may touch production):
 *   mongod --port 27030 --dbpath <tmp> --fork --logpath <tmp>/mongod.log
 * Override with TEST_MONGO_URI. Without it the suite skips.
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');

const MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27030/ciiscalltest';

const canReach = (host, port) => new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1200);
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    socket.on('timeout', () => done(false));
});

const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = code => { res.statusCode = code; return res; };
    res.json = payload => { res.body = payload; return res; };
    return res;
};
const call = async (handler, req) => {
    const res = fakeRes();
    await handler(req, res, () => {});
    return res;
};

test('break flow', async t => {
    const port = Number(new URL(MONGO_URI.replace('mongodb://', 'http://')).port || 27017);
    if (!(await canReach('127.0.0.1', port))) {
        t.skip(`Local mongod not reachable (${MONGO_URI}) — skipping`);
        return;
    }

    const mongoose = require('mongoose');
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 });

    const User = require('../models/User');
    const Company = require('../models/Company');
    const Department = require('../models/Department');
    const Attendance = require('../HR-CDS/models/Attendance');
    const Notification = require('../HR-CDS/models/Notification');
    const SidebarConfig = require('../models/SidebarConfig');
    const controller = require('../HR-CDS/controllers/breakController');
    const { dateKeyOf } = require('../HR-CDS/utils/breaks');

    const COMPANY_CODE = 'ZZTESTBRK';
    const company = new mongoose.Types.ObjectId();
    const otherCompany = new mongoose.Types.ObjectId();
    const fixedDept = new mongoose.Types.ObjectId();
    const flexDept = new mongoose.Types.ObjectId();
    const ids = {
        fixed: new mongoose.Types.ObjectId(),     // works in the fixed-break department
        flex: new mongoose.Types.ObjectId(),      // works in the flexible department
        outsider: new mongoose.Types.ObjectId(),
    };
    const admin = { _id: new mongoose.Types.ObjectId(), name: 'ZZTEST HR', company, companyCode: COMPANY_CODE, jobRole: 'hr' };

    // India-time helpers for "today", so the windows below are today's windows.
    const todayKey = dateKeyOf(new Date());
    const atClock = clock => {
        const [hours, minutes] = clock.split(':').map(Number);
        return new Date(new Date(`${todayKey}T00:00:00.000Z`).getTime() - 5.5 * 3600 * 1000 + (hours * 60 + minutes) * 60000);
    };

    const employee = (userId, name, department) => ({
        _id: userId, id: String(userId), name, company, companyCode: COMPANY_CODE, department,
    });

    const drop = async () => {
        await Promise.all([
            User.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Company.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Department.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Attendance.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Notification.deleteMany({ type: 'break_update' }).catch(() => {}),
            SidebarConfig.deleteMany({ companyId: company }).catch(() => {}),
        ]);
    };
    await drop();
    t.after(async () => {
        await drop();
        await mongoose.disconnect().catch(() => {});
    });

    await Company.collection.insertOne({
        _id: company, companyName: 'ZZTEST Breaks Co', companyCode: COMPANY_CODE, isActive: true,
        // The company runs flexible breaks with a soft limit…
        breakPolicy: { mode: 'FLEXIBLE', notifyAdmin: true, limits: { enabled: true, maxBreaksPerDay: 2, enforce: 'WARN' } },
    });
    await Department.collection.insertMany([
        {
            // …but this department has fixed breaks for everyone.
            _id: fixedDept, name: 'ZZTEST Floor', company, companyCode: COMPANY_CODE, workingDays: 6, isActive: true,
            breakPolicy: { mode: 'FIXED', fixedBreaks: [{ name: 'Lunch', start: '13:00', end: '13:30', autoDeduct: true }], allowExtraBreak: true, notifyAdmin: true },
        },
        { _id: flexDept, name: 'ZZTEST Support', company, companyCode: COMPANY_CODE, workingDays: 6, isActive: true },
    ]);
    await User.collection.insertMany([
        { _id: ids.fixed, name: 'ZZTEST Fixed', email: 'zzbrk-fixed@example.com', company, companyCode: COMPANY_CODE, department: fixedDept, isActive: true },
        { _id: ids.flex, name: 'ZZTEST Flex', email: 'zzbrk-flex@example.com', company, companyCode: COMPANY_CODE, department: flexDept, isActive: true },
        { _id: ids.outsider, name: 'ZZTEST Outsider', email: 'zzbrk-out@example.com', company: otherCompany, companyCode: 'ZZOTHER', department: flexDept, isActive: true },
    ]);

    // Notifications reach whoever has the Employee Attendance page in their sidebar.
    await SidebarConfig.collection.insertOne({
        companyId: company, role: 'hr', isActive: true,
        menuItems: [{ path: '/ciisUser/emp-attendance', label: 'Employee Attendance' }],
        createdAt: new Date(), updatedAt: new Date(),
    });
    await User.collection.insertOne({
        _id: admin._id, name: admin.name, email: 'zzbrk-hr@example.com', company,
        companyCode: COMPANY_CODE, department: flexDept, jobRole: 'hr', isActive: true,
    });

    const breakNotifications = async () => Notification.find({ type: 'break_update' }).sort({ createdAt: 1 }).lean();

    const clockIn = async (userId, at) => {
        await Attendance.deleteMany({ user: userId });
        return Attendance.create({
            user: userId, companyCode: COMPANY_CODE, date: at, inTime: at, isClockedIn: true,
            status: 'PRESENT', shiftStart: '09:00', shiftEnd: '18:00',
        });
    };

    await t.test('the department policy beats the company one', async () => {
        const fixedRes = await call(controller.getToday, { user: employee(ids.fixed, 'ZZTEST Fixed', fixedDept), query: {} });
        assert.equal(fixedRes.body.success, true);
        assert.equal(fixedRes.body.policy.mode, 'FIXED');
        assert.equal(fixedRes.body.policy.source, 'department');
        assert.equal(fixedRes.body.policy.fixedBreaks[0].name, 'Lunch');

        const flexRes = await call(controller.getToday, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), query: {} });
        assert.equal(flexRes.body.policy.mode, 'FLEXIBLE');
        assert.equal(flexRes.body.policy.source, 'company');
        assert.equal(flexRes.body.policy.limits.maxBreaksPerDay, 2);
    });

    await t.test('a break cannot start before clocking in', async () => {
        await Attendance.deleteMany({ user: ids.flex });
        const res = await call(controller.startBreak, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), body: {} });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Clock in first/);
    });

    await t.test('a flexible break starts, pauses working time, and ends', async () => {
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await clockIn(ids.flex, atClock('09:30'));

        const started = await call(controller.startBreak, { user, body: {} });
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        assert.equal(started.body.onBreak, true);
        assert.equal(started.body.breaks[0].type, 'FLEXIBLE');

        // Working time is in-to-now minus the break, so it stops growing while the break runs.
        const during = await call(controller.getToday, { user, query: {} });
        assert.equal(during.body.onBreak, true);
        const firstWorking = during.body.workingSeconds;
        const later = await call(controller.getToday, { user, query: {} });
        assert.equal(Math.abs(later.body.workingSeconds - firstWorking) <= 1, true,
            `working time must not move during a break (${firstWorking} → ${later.body.workingSeconds})`);

        const stopped = await call(controller.stopBreak, { user, body: {} });
        assert.equal(stopped.statusCode, 200);
        assert.equal(stopped.body.onBreak, false);
        assert.equal(stopped.body.breakCount, 1);
    });

    await t.test('two breaks cannot run at once', async () => {
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await call(controller.startBreak, { user, body: {} });
        const second = await call(controller.startBreak, { user, body: {} });
        assert.equal(second.statusCode, 400);
        assert.match(second.body.message, /already running/);
        await call(controller.stopBreak, { user, body: {} });
    });

    await t.test('ending a break when none is running is refused', async () => {
        const res = await call(controller.stopBreak, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), body: {} });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /No break is running/);
    });

    await t.test('a soft limit warns but still lets the break start', async () => {
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        // Two breaks are already taken above (the limit is 2, set to WARN).
        const third = await call(controller.startBreak, { user, body: {} });
        assert.equal(third.statusCode, 200);
        assert.match(third.body.warning, /already taken 2 breaks/);
        await call(controller.stopBreak, { user, body: {} });
    });

    await t.test('a fixed company deducts its window with nothing punched', async () => {
        const user = employee(ids.fixed, 'ZZTEST Fixed', fixedDept);
        const record = await clockIn(ids.fixed, atClock('09:30'));
        record.outTime = atClock('18:30');
        record.isClockedIn = false;
        await record.save();

        const res = await call(controller.getToday, { user, query: {} });
        assert.equal(res.body.breakMinutes, 30, 'lunch is deducted on its own');
        assert.equal(res.body.autoBreakMinutes, 30);
        assert.equal(res.body.punchedBreakMinutes, 0);
        assert.equal(res.body.grossTime, '09:00:00');
        assert.equal(res.body.workingTime, '08:30:00', 'working time is gross minus the break');
    });

    await t.test('a break punched inside the window replaces the automatic one', async () => {
        const user = employee(ids.fixed, 'ZZTEST Fixed', fixedDept);
        const record = await clockIn(ids.fixed, atClock('09:30'));
        record.breaks = [{ type: 'FIXED', label: 'Lunch', start: atClock('13:00'), end: atClock('13:45'), minutes: 45 }];
        record.outTime = atClock('18:30');
        record.isClockedIn = false;
        await record.save();

        const res = await call(controller.getToday, { user, query: {} });
        assert.equal(res.body.punchedBreakMinutes, 45);
        assert.equal(res.body.autoBreakMinutes, 0, 'never 30 + 45');
        assert.equal(res.body.breakMinutes, 45);
        assert.equal(res.body.workingTime, '08:15:00');
    });

    await t.test('a break outside the windows is an extra break and is allowed', async () => {
        const user = employee(ids.fixed, 'ZZTEST Fixed', fixedDept);
        await clockIn(ids.fixed, atClock('09:30'));
        const started = await call(controller.startBreak, { user, body: {} });
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        // "Now" is almost never inside 13:00–13:30, so this is the extra-break path.
        const entry = started.body.breaks[started.body.breaks.length - 1];
        assert.equal(['EXTRA', 'FIXED'].includes(entry.type), true);
        await call(controller.stopBreak, { user, body: {} });
    });

    await t.test('an admin sees every level and can change one', async () => {
        const settings = await call(controller.getSettings, { user: admin, query: {} });
        assert.equal(settings.body.success, true);
        assert.equal(settings.body.company.policy.mode, 'FLEXIBLE');
        const floor = settings.body.departments.find(item => item.name === 'ZZTEST Floor');
        assert.equal(floor.policy.mode, 'FIXED');
        const support = settings.body.departments.find(item => item.name === 'ZZTEST Support');
        assert.equal(support.policy.mode, 'INHERIT', 'a department with nothing set inherits');

        const saved = await call(controller.updateSettings, {
            user: admin,
            params: { level: 'department', id: String(flexDept) },
            body: { policy: { mode: 'FIXED', fixedBreaks: [{ name: 'Tea', start: '16:00', end: '16:20' }] } },
        });
        assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.data.policy.fixedBreaks[0].minutes, 20);

        // And the employee in that department now sees it.
        const mine = await call(controller.getToday, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), query: {} });
        assert.equal(mine.body.policy.mode, 'FIXED');
        assert.equal(mine.body.policy.fixedBreaks[0].name, 'Tea');

        // Back to inheriting the company policy.
        const cleared = await call(controller.updateSettings, {
            user: admin, params: { level: 'department', id: String(flexDept) }, body: { policy: { mode: 'INHERIT' } },
        });
        assert.equal(cleared.statusCode, 200);
        const after = await call(controller.getToday, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), query: {} });
        assert.equal(after.body.policy.mode, 'FLEXIBLE');
    });

    await t.test('bad settings are refused', async () => {
        const noWindows = await call(controller.updateSettings, {
            user: admin, params: { level: 'department', id: String(flexDept) }, body: { policy: { mode: 'FIXED', fixedBreaks: [] } },
        });
        assert.equal(noWindows.statusCode, 400);
        assert.match(noWindows.body.message, /at least one break window/);

        const brokenWindow = await call(controller.updateSettings, {
            user: admin,
            params: { level: 'department', id: String(flexDept) },
            body: { policy: { mode: 'FIXED', fixedBreaks: [{ name: 'Bad', start: '14:00', end: '13:00' }] } },
        });
        assert.equal(brokenWindow.statusCode, 400);

        const badLevel = await call(controller.updateSettings, {
            user: admin, params: { level: 'planet', id: String(flexDept) }, body: { policy: { mode: 'OFF' } },
        });
        assert.equal(badLevel.statusCode, 400);
    });

    await t.test('an admin cannot change another company\'s settings', async () => {
        const otherDept = new mongoose.Types.ObjectId();
        await Department.collection.insertOne({
            _id: otherDept, name: 'ZZTEST Other Co Dept', company: otherCompany, companyCode: 'ZZOTHER', workingDays: 6, isActive: true,
        });
        const res = await call(controller.updateSettings, {
            user: admin, params: { level: 'department', id: String(otherDept) }, body: { policy: { mode: 'OFF' } },
        });
        assert.equal(res.statusCode, 403);
        await Department.collection.deleteOne({ _id: otherDept });
    });

    await t.test('the live report shows who is on a break now', async () => {
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await clockIn(ids.flex, atClock('09:30'));
        await call(controller.startBreak, { user, body: {} });

        const live = await call(controller.getLive, { user: admin, query: {} });
        assert.equal(live.body.success, true);
        assert.equal(live.body.onBreakNow >= 1, true);
        const row = live.body.items.find(item => item.userId === String(ids.flex));
        assert.equal(row.onBreak, true);
        assert.equal(Boolean(row.runningSince), true);

        await call(controller.stopBreak, { user, body: {} });
        const after = await call(controller.getLive, { user: admin, query: {} });
        assert.equal(after.body.items.find(item => item.userId === String(ids.flex)).onBreak, false);
    });

    await t.test('a flexible break tells the admin when it starts and when it ends', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await clockIn(ids.flex, atClock('09:30'));
        await call(controller.startBreak, { user, body: {} });
        await call(controller.stopBreak, { user, body: {} });

        const notes = await breakNotifications();
        assert.equal(notes.length, 2, `expected a start and an end notification, got ${notes.length}`);
        assert.equal(notes[0].title, 'Break started');
        assert.equal(notes[1].title, 'Break ended');
        assert.equal(String(notes[0].recipients?.[0] || notes[0].recipient), String(admin._id));
    });

    await t.test('a scheduled fixed break tells the admin nothing', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        const user = employee(ids.fixed, 'ZZTEST Fixed', fixedDept);
        const record = await clockIn(ids.fixed, atClock('09:30'));
        // Punch the lunch break itself: this is the expected break, so it must stay quiet.
        record.breaks = [{ type: 'FIXED', label: 'Lunch', start: atClock('13:00'), end: null, minutes: 0 }];
        record.onBreak = true;
        await record.save();
        await call(controller.stopBreak, { user, body: {} });

        assert.equal((await breakNotifications()).length, 0, 'a scheduled break must not notify anyone');
    });

    await t.test('an extra break in a fixed company does tell the admin', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        const user = employee(ids.fixed, 'ZZTEST Fixed', fixedDept);
        const record = await clockIn(ids.fixed, atClock('09:30'));
        record.breaks = [{ type: 'EXTRA', label: 'Extra break', start: atClock('11:00'), end: null, minutes: 0 }];
        record.onBreak = true;
        await record.save();
        await call(controller.stopBreak, { user, body: {} });

        const notes = await breakNotifications();
        assert.equal(notes.length, 1);
        assert.equal(notes[0].title, 'Break ended');
        assert.match(notes[0].message, /ended their break/);
    });

    await t.test('switching notifications off keeps the admin quiet', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        await Company.collection.updateOne({ _id: company }, { $set: { 'breakPolicy.notifyAdmin': false } });
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await clockIn(ids.flex, atClock('09:30'));
        await call(controller.startBreak, { user, body: {} });
        await call(controller.stopBreak, { user, body: {} });
        assert.equal((await breakNotifications()).length, 0);
        await Company.collection.updateOne({ _id: company }, { $set: { 'breakPolicy.notifyAdmin': true } });
    });

    await t.test('the batch resolver gives the same policy as resolving one employee at a time', async () => {
        const resolver = await controller.buildCompanyPolicyResolver({ company, companyCode: COMPANY_CODE });
        for (const userId of [ids.fixed, ids.flex]) {
            const userDoc = await User.findById(userId).lean();
            const single = await controller.policyForUser(userDoc);
            const batched = resolver.policyFor(userDoc);
            assert.equal(batched.mode, single.policy.mode, `${userDoc.name}: mode`);
            assert.equal(batched.source, single.policy.source, `${userDoc.name}: source`);
            assert.deepEqual(batched.fixedBreaks, single.policy.fixedBreaks);
        }
    });

    await t.test('a break can be tagged, and the tag can be made compulsory', async () => {
        await Company.collection.updateOne({ _id: company }, {
            $set: { 'breakPolicy.requireReason': true, 'breakPolicy.reasons': ['Lunch', 'Tea', 'Personal'] },
        });
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        await clockIn(ids.flex, atClock('09:30'));

        const noReason = await call(controller.startBreak, { user, body: {} });
        assert.equal(noReason.statusCode, 400);
        assert.match(noReason.body.message, /what this break is for/);

        const wrongReason = await call(controller.startBreak, { user, body: { reason: 'Cricket' } });
        assert.equal(wrongReason.statusCode, 400);
        assert.match(wrongReason.body.message, /Lunch, Tea, Personal/);

        const tagged = await call(controller.startBreak, { user, body: { reason: 'Tea' } });
        assert.equal(tagged.statusCode, 200, JSON.stringify(tagged.body));
        const entry = tagged.body.breaks[tagged.body.breaks.length - 1];
        assert.equal(entry.reason, 'Tea');
        assert.equal(entry.label, 'Tea');
        await call(controller.stopBreak, { user, body: {} });

        await Company.collection.updateOne({ _id: company }, { $set: { 'breakPolicy.requireReason': false } });
    });

    await t.test('breaks have to be a set number of minutes apart', async () => {
        await Company.collection.updateOne({ _id: company }, {
            $set: { 'breakPolicy.limits': { enabled: true, minGapMinutes: 60, enforce: 'BLOCK' } },
        });
        const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
        const record = await clockIn(ids.flex, atClock('09:30'));
        // A break that ended a few minutes ago.
        record.breaks = [{ type: 'FLEXIBLE', label: 'Break', start: new Date(Date.now() - 20 * 60000), end: new Date(Date.now() - 10 * 60000), minutes: 10 }];
        await record.save();

        const tooSoon = await call(controller.startBreak, { user, body: {} });
        assert.equal(tooSoon.statusCode, 400);
        assert.match(tooSoon.body.message, /60 minutes apart/);

        // With the gap passed it is allowed again.
        record.breaks = [{ type: 'FLEXIBLE', label: 'Break', start: new Date(Date.now() - 180 * 60000), end: new Date(Date.now() - 170 * 60000), minutes: 10 }];
        await record.save();
        const allowed = await call(controller.startBreak, { user, body: {} });
        assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
        await call(controller.stopBreak, { user, body: {} });
    });

    await t.test('a break running past the cap alerts the admin and the employee, once', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        await Company.collection.updateOne({ _id: company }, {
            $set: { 'breakPolicy.limits': { enabled: true, maxSingleBreakMinutes: 20, enforce: 'WARN' } },
        });
        const record = await clockIn(ids.flex, atClock('09:30'));
        // A break that started 35 minutes ago and is still running.
        record.breaks = [{ type: 'FLEXIBLE', label: 'Break', reason: 'Personal', start: new Date(Date.now() - 35 * 60000), end: null, minutes: 0 }];
        record.onBreak = true;
        await record.save();

        const first = await controller.sendOverstayAlerts();
        assert.equal(first.alerted, 1, JSON.stringify(first));
        const notes = await breakNotifications();
        assert.equal(notes.length, 2, 'one for the admin, one for the employee');
        assert.equal(notes.some(note => note.title === 'Break running long'), true);
        assert.equal(notes.some(note => note.title === 'Your break is running long'), true);

        const marked = await Attendance.findById(record._id).lean();
        assert.equal(Boolean(marked.breaks[0].overstayNotifiedAt), true, 'the break is marked as alerted');

        const second = await controller.sendOverstayAlerts();
        assert.equal(second.alerted, 0, 'the same break is not reported twice');
        assert.equal((await breakNotifications()).length, 2);

        // The live report shows how far over it is.
        const live = await call(controller.getLive, { user: admin, query: {} });
        const row = live.body.items.find(item => item.userId === String(ids.flex));
        assert.equal(row.overstayMinutes >= 14, true, `overBy ${row.overstayMinutes}`);

        await call(controller.stopBreak, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), body: {} });
        await Company.collection.updateOne({ _id: company }, { $unset: { 'breakPolicy.limits': '' } });
    });

    await t.test('a break under the cap is not reported', async () => {
        await Notification.deleteMany({ type: 'break_update' });
        await Company.collection.updateOne({ _id: company }, {
            $set: { 'breakPolicy.limits': { enabled: true, maxSingleBreakMinutes: 60, enforce: 'WARN' } },
        });
        const record = await clockIn(ids.flex, atClock('09:30'));
        record.breaks = [{ type: 'FLEXIBLE', label: 'Break', start: new Date(Date.now() - 10 * 60000), end: null, minutes: 0 }];
        record.onBreak = true;
        await record.save();
        const result = await controller.sendOverstayAlerts();
        assert.equal(result.alerted, 0);
        await call(controller.stopBreak, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), body: {} });
        await Company.collection.updateOne({ _id: company }, { $unset: { 'breakPolicy.limits': '' } });
    });

    await t.test('the monthly report adds up break time per employee and per reason', async () => {
        const monthKey = dateKeyOf(new Date()).slice(0, 7);
        const record = await clockIn(ids.flex, atClock('09:30'));
        record.breaks = [
            { type: 'FLEXIBLE', label: 'Lunch', reason: 'Lunch', start: atClock('13:00'), end: atClock('13:40'), minutes: 40 },
            { type: 'FLEXIBLE', label: 'Tea', reason: 'Tea', start: atClock('16:00'), end: atClock('16:10'), minutes: 10 },
        ];
        record.outTime = atClock('18:30');
        record.isClockedIn = false;
        record.onBreak = false;
        await record.save();

        const res = await call(controller.getReport, { user: admin, query: { month: monthKey } });
        assert.equal(res.body.success, true, JSON.stringify(res.body));
        const row = res.body.items.find(item => item.userId === String(ids.flex));
        assert.equal(Boolean(row), true, 'the employee is in the report');
        assert.equal(row.totalMinutes, 50);
        assert.equal(row.byReason.Lunch, 40);
        assert.equal(row.byReason.Tea, 10);
        assert.equal(row.breakCount, 2);
        assert.equal(row.longestBreakMinutes, 40);
        assert.equal(row.averageMinutesPerDay, 50, 'one day of records');
        assert.equal(res.body.summary.byReason.Lunch >= 40, true);
        assert.equal(res.body.month, monthKey);
    });

    await t.test('the report counts the days that went over the daily limit', async () => {
        await Company.collection.updateOne({ _id: company }, {
            $set: { 'breakPolicy.limits': { enabled: true, maxMinutesPerDay: 30, enforce: 'WARN' } },
        });
        const monthKey = dateKeyOf(new Date()).slice(0, 7);
        const res = await call(controller.getReport, { user: admin, query: { month: monthKey } });
        const row = res.body.items.find(item => item.userId === String(ids.flex));
        assert.equal(row.overLimitDays, 1, '50 minutes against a 30 minute limit');
        assert.equal(row.limit.maxMinutesPerDay, 30);
        await Company.collection.updateOne({ _id: company }, { $unset: { 'breakPolicy.limits': '' } });
    });

    await t.test('starting and ending a break tells the company who stepped away', async () => {
        const events = [];
        const previousIo = global.io;
        global.io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
        try {
            const user = employee(ids.flex, 'ZZTEST Flex', flexDept);
            await clockIn(ids.flex, atClock('09:30'));
            await call(controller.startBreak, { user, body: { reason: 'Tea' } });
            await call(controller.stopBreak, { user, body: {} });
        } finally {
            global.io = previousIo;
        }
        const presence = events.filter(item => item.event === 'presence:break');
        assert.equal(presence.length, 2, `expected a start and an end broadcast, got ${presence.length}`);
        assert.equal(presence[0].room, `company:${company}`);
        assert.equal(presence[0].payload.onBreak, true);
        assert.equal(presence[0].payload.reason, 'Tea');
        assert.equal(presence[1].payload.onBreak, false);
    });

    await t.test('breaks are off unless somebody switches them on', async () => {
        await Company.collection.updateOne({ _id: company }, { $unset: { breakPolicy: '' } });
        const res = await call(controller.getToday, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), query: {} });
        assert.equal(res.body.policy.mode, 'OFF');
        const start = await call(controller.startBreak, { user: employee(ids.flex, 'ZZTEST Flex', flexDept), body: {} });
        assert.equal(start.statusCode, 400);
        assert.match(start.body.message, /off for your company/);
    });
});
