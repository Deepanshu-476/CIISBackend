/**
 * The app's call-log sweep asks the server which numbers from the phone's call log are this user's
 * leads, and which of their calls are already stored with a recording. That answer decides whether a
 * call is sent for the first time, re-sent only to attach a recording that showed up late, or left
 * alone — so these rules are what keep short and incoming calls from being lost or duplicated.
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

const callMatchPhones = async (controller, { body, user, company }) => {
    const res = fakeRes();
    let error = null;
    await controller.matchPhones({ body, user, telecallerCompany: company }, res, err => { error = err; });
    assert.equal(error, null, `matchPhones failed: ${error?.message}`);
    return res;
};

test('telecaller match-phones', async t => {
    const port = Number(new URL(MONGO_URI.replace('mongodb://', 'http://')).port || 27017);
    if (!(await canReach('127.0.0.1', port))) {
        t.skip(`Local mongod not reachable (${MONGO_URI}) — skipping`);
        return;
    }

    const mongoose = require('mongoose');
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 });

    const Lead = require('../models/Lead');
    const controller = require('../controllers/telecallerController');

    const company = new mongoose.Types.ObjectId();
    const agent = new mongoose.Types.ObjectId();
    const otherAgent = new mongoose.Types.ObjectId();
    const user = { _id: agent, id: String(agent), name: 'ZZTEST Agent', role: 'employee' };
    const now = Date.now();
    const iso = millis => new Date(millis);

    const ids = { ramesh: new mongoose.Types.ObjectId(), sunita: new mongoose.Types.ObjectId(), other: new mongoose.Types.ObjectId() };

    const drop = async () => { await Lead.collection.deleteMany({ company }).catch(() => {}); };
    await drop();
    t.after(async () => {
        await drop();
        await mongoose.disconnect().catch(() => {});
    });

    // insertMany on the collection skips the schema validators: only the read fields matter here.
    await Lead.collection.insertMany([
        {
            _id: ids.ramesh, company, assignedTo: agent, name: 'ZZTEST Ramesh', phone: '+91 98765 43210',
            callHistory: [
                { id: 'calllog_withrec', recordingUrl: '/uploads/recordings/rec_1.m4a', date: iso(now - 60 * 60 * 1000) },
                { id: 'calllog_norec', recordingUrl: '', date: iso(now - 2 * 60 * 60 * 1000) },
                { id: 'calllog_old', recordingUrl: '/uploads/recordings/rec_old.m4a', date: iso(now - 20 * 24 * 60 * 60 * 1000) },
            ],
        },
        { _id: ids.sunita, company, assignedTo: agent, name: 'ZZTEST Sunita', phone: '9123456780', callHistory: [] },
        { _id: ids.other, company, assignedTo: otherAgent, name: 'ZZTEST Someone Else', phone: '9000000111', callHistory: [] },
    ]);

    await t.test('a number is matched to the lead however the phone formatted it', async () => {
        const res = await callMatchPhones(controller, {
            body: { phones: ['09876543210', '+919123456780', '9555000111'] },
            user,
            company,
        });
        const byPhone = Object.fromEntries((res.body.items || []).map(item => [item.phone, item]));
        assert.equal(byPhone['9876543210']?.leadId, String(ids.ramesh));
        assert.equal(byPhone['9876543210']?.leadName, 'ZZTEST Ramesh');
        assert.equal(byPhone['9123456780']?.leadId, String(ids.sunita));
        assert.equal(byPhone['9555000111'], undefined, 'a number that is nobody\'s lead is not returned');
    });

    await t.test('calls already stored are reported, and only the recorded ones as recorded', async () => {
        const res = await callMatchPhones(controller, { body: { phones: ['9876543210'] }, user, company });
        const item = res.body.items[0];
        // A call without a recording stays listed, so the app can attach one found later.
        assert.deepEqual([...item.callIds].sort(), ['calllog_norec', 'calllog_withrec']);
        assert.deepEqual(item.recordedCallIds, ['calllog_withrec']);
        assert.equal(item.callIds.includes('calllog_old'), false, 'calls older than the window are left out');
    });

    await t.test('the window can be widened, up to a month', async () => {
        const res = await callMatchPhones(controller, { body: { phones: ['9876543210'], sinceDays: 25 }, user, company });
        assert.equal(res.body.sinceDays, 25);
        assert.equal(res.body.items[0].callIds.includes('calllog_old'), true);

        const clamped = await callMatchPhones(controller, { body: { phones: ['9876543210'], sinceDays: 999 }, user, company });
        assert.equal(clamped.body.sinceDays, 30);
    });

    await t.test('an agent never learns about another agent\'s lead', async () => {
        const res = await callMatchPhones(controller, { body: { phones: ['9000000111'] }, user, company });
        assert.deepEqual(res.body.items, []);
    });

    await t.test('an admin sees the whole company', async () => {
        const res = await callMatchPhones(controller, {
            body: { phones: ['9000000111'] },
            user: { ...user, role: 'admin' },
            company,
        });
        assert.equal(res.body.items[0]?.leadId, String(ids.other));
    });

    await t.test('junk input is answered with an empty list, not an error', async () => {
        for (const body of [{}, { phones: [] }, { phones: ['12', 'abc', null] }]) {
            const res = await callMatchPhones(controller, { body, user, company });
            assert.deepEqual(res.body.items, []);
        }
    });

    await t.test('a huge batch is capped instead of scanning on forever', async () => {
        const phones = Array.from({ length: 400 }, (_, index) => `98765${String(index).padStart(5, '0')}`);
        const res = await callMatchPhones(controller, { body: { phones: [...phones, '9876543210'] }, user, company });
        // The 201st number onwards is dropped, so the known lead past the cap is not returned.
        assert.equal((res.body.items || []).length, 0);
    });
});
