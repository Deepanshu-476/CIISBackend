/**
 * The weekly-off request flow end to end through the controller: an employee asks to take this
 * week's off on another day, an approver decides, and the schedule that attendance and payroll read
 * changes only once it is approved.
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

// Each handler is called the way express would, and the result is returned for assertions.
const call = async (handler, req) => {
    const res = fakeRes();
    await handler(req, res, () => {});
    return res;
};

test('weekly off requests', async t => {
    const port = Number(new URL(MONGO_URI.replace('mongodb://', 'http://')).port || 27017);
    if (!(await canReach('127.0.0.1', port))) {
        t.skip(`Local mongod not reachable (${MONGO_URI}) — skipping`);
        return;
    }

    const mongoose = require('mongoose');
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 });

    const User = require('../models/User');
    const Department = require('../models/Department');
    const Holiday = require('../HR-CDS/models/Holiday');
    const WeekOffRequest = require('../HR-CDS/models/WeekOffRequest');
    const controller = require('../HR-CDS/controllers/weekOffController');
    const { resolveOffDayKeys, dateKeyOf, weekStartKeyOf, addDaysToKey } = require('../HR-CDS/utils/weekOff');

    const company = new mongoose.Types.ObjectId();
    const otherCompany = new mongoose.Types.ObjectId();
    const deptId = new mongoose.Types.ObjectId();
    const ids = {
        ramesh: new mongoose.Types.ObjectId(),
        sunita: new mongoose.Types.ObjectId(),
        outsider: new mongoose.Types.ObjectId(),
    };
    const COMPANY_CODE = 'ZZTESTWO';

    // The second Monday of next month: in the future (so "that week is over" never interferes) and
    // far enough from both month ends that every date this suite touches sits in the same month,
    // because the schedule endpoint answers one month at a time.
    const monday = (() => {
        const [year, month] = dateKeyOf(new Date()).split('-').map(Number);
        const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
        const first = `${nextMonth}-01`;
        const firstMonday = weekStartKeyOf(first) < first ? addDaysToKey(weekStartKeyOf(first), 7) : weekStartKeyOf(first);
        return addDaysToKey(firstMonday, 7);
    })();
    const day = offset => addDaysToKey(monday, offset);
    const TUE = day(1);
    const WED = day(2);
    const THU = day(3);
    const SUN = day(6);

    const employee = (userId, name) => ({
        _id: userId,
        id: String(userId),
        name,
        company,
        companyCode: COMPANY_CODE,
        department: deptId,
    });
    const approver = { _id: new mongoose.Types.ObjectId(), name: 'ZZTEST HR', company, companyCode: COMPANY_CODE, jobRole: 'hr' };

    const drop = async () => {
        await Promise.all([
            User.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Department.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            WeekOffRequest.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
            Holiday.collection.deleteMany({ companyCode: COMPANY_CODE }).catch(() => {}),
        ]);
    };
    await drop();
    t.after(async () => {
        await drop();
        await mongoose.disconnect().catch(() => {});
    });

    // Six working days a week: one weekly off, which by default falls on Sunday.
    await Department.collection.insertOne({
        _id: deptId, name: 'ZZTEST Sales', company, companyCode: COMPANY_CODE,
        workingDays: 6, workingDayHistory: [], isActive: true,
    });
    await User.collection.insertMany([
        { _id: ids.ramesh, name: 'ZZTEST Ramesh', email: 'zzwo-ramesh@example.com', company, companyCode: COMPANY_CODE, department: deptId, isActive: true, weekOffDays: [] },
        { _id: ids.sunita, name: 'ZZTEST Sunita', email: 'zzwo-sunita@example.com', company, companyCode: COMPANY_CODE, department: deptId, isActive: true, weekOffDays: [2] },
        { _id: ids.outsider, name: 'ZZTEST Outsider', email: 'zzwo-out@example.com', company: otherCompany, companyCode: 'ZZOTHER', department: deptId, isActive: true },
    ]);

    await t.test('an employee with no day set sees the department default', async () => {
        const res = await call(controller.getMySchedule, { user: employee(ids.ramesh, 'ZZTEST Ramesh'), query: { month: monday.slice(0, 7) } });
        assert.equal(res.body.success, true);
        assert.equal(res.body.workingDays, 6);
        assert.equal(res.body.entitlement, 1);
        assert.deepEqual(res.body.weekOffDays, []);
        assert.equal(res.body.offDayKeys.includes(SUN), true, 'Sunday is the off day');
        assert.equal(res.body.offDayKeys.includes(TUE), false);
    });

    await t.test("an employee's own day replaces the default", async () => {
        const res = await call(controller.getMySchedule, { user: employee(ids.sunita, 'ZZTEST Sunita'), query: { month: monday.slice(0, 7) } });
        assert.deepEqual(res.body.weekOffDays, [2]);
        assert.deepEqual(res.body.weekOffDayNames, ['Tuesday']);
        assert.equal(res.body.offDayKeys.includes(TUE), true);
        assert.equal(res.body.offDayKeys.includes(SUN), false, 'Sunday is a working day for her');
    });

    let requestId = null;

    await t.test('a swap request is accepted and names the day being given up', async () => {
        const res = await call(controller.createRequest, {
            user: employee(ids.ramesh, 'ZZTEST Ramesh'),
            body: { toDate: WED, reason: 'family function' },
        });
        assert.equal(res.statusCode, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.fromDateKey, SUN);
        assert.equal(res.body.data.toDateKey, WED);
        assert.equal(res.body.data.weekStartKey, monday);
        assert.equal(res.body.data.status, 'Pending');
        requestId = String(res.body.data._id);
    });

    await t.test('a pending request changes nothing until it is approved', async () => {
        const res = await call(controller.getMySchedule, { user: employee(ids.ramesh, 'ZZTEST Ramesh'), query: { month: monday.slice(0, 7) } });
        assert.equal(res.body.offDayKeys.includes(SUN), true, 'still Sunday');
        assert.equal(res.body.offDayKeys.includes(WED), false);
        assert.equal(res.body.requests.length, 1);
    });

    await t.test('a second request for the same week is refused while one is pending', async () => {
        const res = await call(controller.createRequest, { user: employee(ids.ramesh, 'ZZTEST Ramesh'), body: { toDate: THU } });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /waiting for approval/);
    });

    await t.test('nonsense requests are refused with a readable reason', async () => {
        const ramesh = employee(ids.ramesh, 'ZZTEST Ramesh');
        const alreadyOff = await call(controller.createRequest, { user: ramesh, body: { toDate: SUN } });
        assert.equal(alreadyOff.statusCode, 400);
        assert.match(alreadyOff.body.message, /already your weekly off/);

        const noDate = await call(controller.createRequest, { user: ramesh, body: {} });
        assert.equal(noDate.statusCode, 400);

        const pastWeek = await call(controller.createRequest, {
            user: ramesh,
            body: { toDate: addDaysToKey(weekStartKeyOf(dateKeyOf(new Date())), -3) },
        });
        assert.equal(pastWeek.statusCode, 400);
        assert.match(pastWeek.body.message, /already over/);
    });

    await t.test('approving the request moves the off day for that week only', async () => {
        const res = await call(controller.reviewRequest, {
            user: approver,
            params: { id: requestId },
            body: { action: 'approve', remarks: 'ok' },
        });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.status, 'Approved');

        const schedule = await call(controller.getMySchedule, { user: employee(ids.ramesh, 'ZZTEST Ramesh'), query: { month: monday.slice(0, 7) } });
        assert.equal(schedule.body.offDayKeys.includes(WED), true, 'Wednesday is now the off day');
        assert.equal(schedule.body.offDayKeys.includes(SUN), false, 'and Sunday is a working day');
        // The following week is untouched.
        assert.equal(schedule.body.offDayKeys.includes(addDaysToKey(SUN, 7)), true);
    });

    await t.test('the same request cannot be acted on twice', async () => {
        const res = await call(controller.reviewRequest, { user: approver, params: { id: requestId }, body: { action: 'reject' } });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /already approved/);
    });

    await t.test('after the swap, the next request that week is validated against it', async () => {
        const ramesh = employee(ids.ramesh, 'ZZTEST Ramesh');
        const again = await call(controller.createRequest, { user: ramesh, body: { toDate: WED } });
        assert.equal(again.statusCode, 400, 'Wednesday is the off day now');

        const toThursday = await call(controller.createRequest, { user: ramesh, body: { toDate: THU } });
        assert.equal(toThursday.statusCode, 201);
        assert.equal(toThursday.body.data.fromDateKey, WED, 'now Wednesday is what gets given up');
        const rejected = await call(controller.reviewRequest, {
            user: approver,
            params: { id: String(toThursday.body.data._id) },
            body: { action: 'reject', remarks: 'too many changes' },
        });
        assert.equal(rejected.body.data.status, 'Rejected');

        const schedule = await call(controller.getMySchedule, { user: ramesh, query: { month: monday.slice(0, 7) } });
        assert.equal(schedule.body.offDayKeys.includes(WED), true, 'the rejection leaves the approved swap alone');
        assert.equal(schedule.body.offDayKeys.includes(THU), false);
    });

    await t.test('a holiday cannot be asked for as a weekly off', async () => {
        await Holiday.collection.insertOne({
            title: 'ZZTEST Holiday', companyCode: COMPANY_CODE, company,
            date: new Date(`${addDaysToKey(monday, 9)}T06:00:00.000Z`), isActive: true,
        });
        const res = await call(controller.createRequest, {
            user: employee(ids.sunita, 'ZZTEST Sunita'),
            body: { toDate: addDaysToKey(monday, 9) },
        });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /already a company holiday/);
    });

    await t.test('a pending request can be withdrawn, an approved one cannot', async () => {
        const created = await call(controller.createRequest, {
            user: employee(ids.sunita, 'ZZTEST Sunita'),
            body: { toDate: addDaysToKey(monday, 10) },
        });
        assert.equal(created.statusCode, 201);
        const withdrawn = await call(controller.cancelRequest, {
            user: employee(ids.sunita, 'ZZTEST Sunita'),
            params: { id: String(created.body.data._id) },
        });
        assert.equal(withdrawn.statusCode, 200);

        const someoneElse = await call(controller.cancelRequest, {
            user: employee(ids.ramesh, 'ZZTEST Ramesh'),
            params: { id: requestId },
        });
        assert.equal(someoneElse.statusCode, 400, 'approved requests stay');
    });

    await t.test('an approver sees the company\'s requests with the employee on them', async () => {
        const res = await call(controller.getAdminRequests, { user: approver, query: { status: 'All' } });
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.length >= 2, true);
        assert.equal(Boolean(res.body.data[0].user?.name), true, 'employee is populated');
    });

    await t.test('an admin sets and clears an employee\'s fixed weekly off', async () => {
        const set = await call(controller.updateEmployeeSettings, {
            user: approver,
            params: { userId: String(ids.ramesh) },
            body: { weekOffDays: [3] },
        });
        assert.equal(set.statusCode, 200, JSON.stringify(set.body));
        assert.deepEqual(set.body.data.weekOffDays, [3]);

        const schedule = await call(controller.getMySchedule, { user: employee(ids.ramesh, 'ZZTEST Ramesh'), query: { month: monday.slice(0, 7) } });
        assert.equal(schedule.body.offDayKeys.includes(addDaysToKey(SUN, 7)), false, 'next week is Wednesday now');
        assert.equal(schedule.body.offDayKeys.includes(addDaysToKey(monday, 9)), true);

        const cleared = await call(controller.updateEmployeeSettings, {
            user: approver,
            params: { userId: String(ids.ramesh) },
            body: { weekOffDays: [] },
        });
        assert.deepEqual(cleared.body.data.weekOffDays, []);
    });

    await t.test('more days than the department allows are refused', async () => {
        const res = await call(controller.updateEmployeeSettings, {
            user: approver,
            params: { userId: String(ids.sunita) },
            body: { weekOffDays: [2, 5] },
        });
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /at most 1 day/);

        const junk = await call(controller.updateEmployeeSettings, {
            user: approver,
            params: { userId: String(ids.sunita) },
            body: { weekOffDays: [0, 8] },
        });
        assert.equal(junk.statusCode, 400);
    });

    await t.test('an approver cannot touch another company\'s employee or request', async () => {
        const res = await call(controller.updateEmployeeSettings, {
            user: approver,
            params: { userId: String(ids.outsider) },
            body: { weekOffDays: [1] },
        });
        assert.equal(res.statusCode, 403);
    });

    await t.test('what payroll reads matches what the employee was shown', async () => {
        // Payroll resolves off days from the same helper, with the swaps it loads itself.
        const swaps = await WeekOffRequest.find({ user: ids.sunita, status: 'Approved' }).lean();
        const user = await User.findById(ids.sunita).select('weekOffDays').lean();
        const department = await Department.findById(deptId).select('name workingDays workingDayHistory').lean();
        const keys = resolveOffDayKeys({
            department,
            weekOffDays: user.weekOffDays,
            swaps,
            from: monday,
            to: addDaysToKey(monday, 6),
        });
        const schedule = await call(controller.getMySchedule, { user: employee(ids.sunita, 'ZZTEST Sunita'), query: { month: monday.slice(0, 7) } });
        const shown = schedule.body.offDayKeys.filter(key => key >= monday && key <= addDaysToKey(monday, 6));
        assert.deepEqual([...keys].sort(), shown.sort());
    });
});
