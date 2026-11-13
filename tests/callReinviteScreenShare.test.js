/**
 * Call regression tests: re-ringing someone who left, rejoining, and screen-share signalling.
 *
 * Needs a throwaway mongod and redis (nothing here may touch production):
 *   mongod --port 27030 --dbpath <tmp> --fork --logpath <tmp>/mongod.log
 *   redis-server --port 6399 --daemonize yes --save ''
 * Override with TEST_MONGO_URI / TEST_REDIS_URL. Without them the suite skips.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const net = require("net");

process.env.JWT_SECRET = process.env.JWT_SECRET || "call-test-secret";
process.env.DISABLE_SCHEDULED_JOBS = "true";
process.env.CALL_RING_TIMEOUT_MS = process.env.CALL_RING_TIMEOUT_MS || "8000";

const MONGO_URI = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27030/ciiscalltest";
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6399";
process.env.REDIS_URL = REDIS_URL;

const canReach = (host, port) => new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1200);
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
});

const servicesUp = async () => {
    const mongoPort = Number(new URL(MONGO_URI.replace("mongodb://", "http://")).port || 27017);
    const redisPort = Number(new URL(REDIS_URL.replace("redis://", "http://")).port || 6379);
    return (await canReach("127.0.0.1", mongoPort)) && (await canReach("127.0.0.1", redisPort));
};

const waitFor = (socket, event, { predicate = () => true, timeout = 6000, label = event } = {}) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timed out waiting for ${label}`));
        }, timeout);
        const handler = payload => {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        socket.on(event, handler);
    });

const waitUntil = async (check, timeout = 3000, step = 50) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return true;
        await new Promise(resolve => setTimeout(resolve, step));
    }
    return false;
};

// Resolves with the first of the two events to arrive, so a wrong one fails loudly.
const raceEvents = (socket, events, timeout = 6000) =>
    new Promise((resolve, reject) => {
        const handlers = [];
        const timer = setTimeout(() => {
            handlers.forEach(([event, handler]) => socket.off(event, handler));
            reject(new Error(`Timed out waiting for one of: ${events.join(", ")}`));
        }, timeout);
        events.forEach(event => {
            const handler = payload => {
                clearTimeout(timer);
                handlers.forEach(([e, h]) => socket.off(e, h));
                resolve({ event, payload });
            };
            handlers.push([event, handler]);
            socket.on(event, handler);
        });
    });

test("call re-invite, rejoin and screen share", async t => {
    if (!(await servicesUp())) {
        t.skip(`Local mongod/redis not reachable (${MONGO_URI}, ${REDIS_URL}) — skipping`);
        return;
    }

    const mongoose = require("mongoose");
    const jwt = require("jsonwebtoken");
    const { Server } = require("socket.io");
    const ioClient = require("socket.io-client");

    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 });

    const User = require("../models/User");
    const Company = require("../models/Company");
    const callStore = require("../HR-CDS/chat/socket/callStore");
    const { attachRedisAdapter, getRedis, closeRedisAdapter } = require("../HR-CDS/socket/redis");
    const authSocket = require("../middleware/authSocket");
    const callSocket = require("../HR-CDS/chat/socket/callSocket");

    const companyId = new mongoose.Types.ObjectId();
    const ids = {
        alice: new mongoose.Types.ObjectId(),
        bob: new mongoose.Types.ObjectId(),
        carol: new mongoose.Types.ObjectId(),
    };
    const conversationId = new mongoose.Types.ObjectId();
    const tag = `ZZTEST-${Date.now()}`;

    // insertOne bypasses the heavy schema validators: these documents only need the fields
    // authSocket and the call handlers read.
    const dropTestDocs = async () => {
        await Company.collection.deleteMany({ companyName: /^ZZTEST/ }).catch(() => {});
        await User.collection.deleteMany({ email: /^zztest-/ }).catch(() => {});
    };
    await dropTestDocs();
    await Company.collection.insertOne({ _id: companyId, companyName: `${tag} Co`, companyCode: "ZZTEST", isActive: true });
    await User.collection.insertMany([
        { _id: ids.alice, name: "ZZTEST Alice", email: `zztest-alice-${tag}@example.com`, company: companyId, companyCode: "ZZTEST", isActive: true },
        { _id: ids.bob, name: "ZZTEST Bob", email: `zztest-bob-${tag}@example.com`, company: companyId, companyCode: "ZZTEST", isActive: true },
        { _id: ids.carol, name: "ZZTEST Carol", email: `zztest-carol-${tag}@example.com`, company: companyId, companyCode: "ZZTEST", isActive: true },
    ]);

    const httpServer = http.createServer();
    const io = new Server(httpServer, { cors: { origin: "*" } });
    await attachRedisAdapter(io);
    io.use(authSocket);
    io.on("connection", socket => {
        socket.join(`user:${socket.userId}`);
        if (socket.companyId) socket.join(`company:${socket.companyId}`);
        callSocket(io, socket);
    });
    await new Promise(resolve => httpServer.listen(0, resolve));
    const port = httpServer.address().port;

    const connect = userId => new Promise((resolve, reject) => {
        const token = jwt.sign({ id: String(userId) }, process.env.JWT_SECRET, { expiresIn: "1h" });
        const client = ioClient(`http://127.0.0.1:${port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
        client.on("connect", () => resolve(client));
        client.on("connect_error", reject);
    });

    const clients = [];
    const openClient = async userId => {
        const client = await connect(userId);
        clients.push(client);
        return client;
    };

    const alice = await openClient(ids.alice);
    const bob = await openClient(ids.bob);
    const carol = await openClient(ids.carol);

    const callId = `${ids.alice}-${Date.now()}`;
    const startedCallIds = [callId];

    t.after(async () => {
        // Always get back to a clean slate, even when an assertion above blew up.
        try {
            clients.forEach(client => client.close());
            const redis = getRedis();
            if (redis) {
                for (const id of startedCallIds) {
                    // scanIterator yields a batch of keys per step in redis v5+, one key in v4.
                    for await (const batch of redis.scanIterator({ MATCH: `ciis:call:${id}*` })) {
                        for (const key of (Array.isArray(batch) ? batch : [batch])) {
                            await redis.del(String(key)).catch(() => {});
                        }
                    }
                    await redis.sRem("ciis:calls", String(id)).catch(() => {});
                }
            }
            await mongoose.connection.collection("callhistories")
                .deleteMany({ callId: { $in: startedCallIds } }).catch(() => {});
            await dropTestDocs();
        } finally {
            io.close();
            await new Promise(resolve => httpServer.close(resolve));
            await closeRedisAdapter().catch(() => {});
            await mongoose.disconnect().catch(() => {});
        }
    });

    // ---- Alice starts a group call with Bob and Carol --------------------------------------
    const bobIncoming = waitFor(bob, "call:incoming", { label: "Bob's first ring" });
    const carolIncoming = waitFor(carol, "call:incoming", { label: "Carol's first ring" });
    alice.emit("call:invite", {
        callId,
        conversationId: String(conversationId),
        participantIds: [String(ids.bob), String(ids.carol)],
        callType: "video",
        isGroupCall: true,
        groupTitle: "ZZTEST Channel",
    });
    assert.equal((await bobIncoming).callId, callId);
    await carolIncoming;

    await t.test("both invitees can accept", async () => {
        const bobJoined = waitFor(bob, "call:joined", { label: "Bob joined" });
        bob.emit("call:accept", { callId });
        await bobJoined;
        const carolJoined = waitFor(carol, "call:joined", { label: "Carol joined" });
        carol.emit("call:accept", { callId });
        await carolJoined;
    });

    await t.test("someone who left can be rung again in the same call and pick up", async () => {
        const aliceSawLeave = waitFor(alice, "call:participant-left", {
            predicate: data => String(data.userId || data.fromUserId) === String(ids.bob),
            label: "Alice seeing Bob leave",
        });
        bob.emit("call:end", { callId });
        await aliceSawLeave;

        // The claim that used to survive the whole call must be gone the moment he leaves.
        const leftoverClaim = await getRedis().get(`ciis:call:${callId}:answer:${ids.bob}`);
        assert.equal(leftoverClaim, null, "leaving must drop the answer claim");

        const bobRingsAgain = waitFor(bob, "call:incoming", { label: "Bob's second ring" });
        alice.emit("call:add-participants", {
            callId,
            participantIds: [String(ids.bob)],
            callType: "video",
            isGroupCall: true,
        });
        await bobRingsAgain;

        const outcome = raceEvents(bob, ["call:joined", "call:answered-elsewhere", "call:unavailable"]);
        bob.emit("call:accept", { callId });
        const { event } = await outcome;
        assert.equal(event, "call:joined", `second accept must join, got ${event}`);
    });

    await t.test("someone who left can also use the ongoing-call Join button", async () => {
        const aliceSawLeave = waitFor(alice, "call:participant-left", {
            predicate: data => String(data.userId || data.fromUserId) === String(ids.carol),
            label: "Alice seeing Carol leave",
        });
        carol.emit("call:end", { callId });
        await aliceSawLeave;

        const rejoined = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("call:rejoin never acknowledged")), 6000);
            carol.emit("call:rejoin", { callId }, response => {
                clearTimeout(timer);
                resolve(response);
            });
        });
        assert.equal(rejoined.success, true, `rejoin failed: ${rejoined.message}`);
    });

    await t.test("screen share is announced to the other participants", async () => {
        const aliceSawShare = waitFor(alice, "call:screen-share", {
            predicate: data => data.callId === callId && String(data.userId) === String(ids.bob),
            label: "Alice seeing Bob's screen share",
        });
        bob.emit("call:screen-share", { callId, sharing: true });
        const shareOn = await aliceSawShare;
        assert.equal(shareOn.sharing, true);
        assert.equal(String(shareOn.screenShareUserId), String(ids.bob));

        // A participant who joins (or reconnects) mid-share learns about it from the roster.
        const carolRoster = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("call:get-roster never acknowledged")), 6000);
            carol.emit("call:get-roster", { callId }, response => {
                clearTimeout(timer);
                resolve(response);
            });
        });
        assert.equal(String(carolRoster.screenShareUserId), String(ids.bob), "roster must carry the current sharer");

        const aliceSawStop = waitFor(alice, "call:screen-share", {
            predicate: data => data.callId === callId && data.sharing === false,
            label: "Alice seeing the share stop",
        });
        bob.emit("call:screen-share", { callId, sharing: false });
        assert.equal((await aliceSawStop).screenShareUserId, null);
    });

    await t.test("a sharer who leaves clears the shared screen for everyone", async () => {
        bob.emit("call:screen-share", { callId, sharing: true });
        await waitFor(alice, "call:screen-share", {
            predicate: data => data.sharing === true,
            label: "share restarted",
        });
        const aliceSawStop = waitFor(alice, "call:screen-share", {
            predicate: data => data.sharing === false && String(data.userId) === String(ids.bob),
            label: "share cleared after the sharer left",
        });
        bob.emit("call:end", { callId });
        await aliceSawStop;
    });

    await t.test("a fresh one-to-one call still rings and connects after an earlier call ended", async () => {
        const oneToOneId = `${ids.alice}-${Date.now()}-solo`;
        startedCallIds.push(oneToOneId);
        const carolIncomingAgain = waitFor(carol, "call:incoming", { label: "Carol's 1:1 ring" });
        alice.emit("call:invite", {
            callId: oneToOneId,
            conversationId: String(conversationId),
            participantIds: [String(ids.carol)],
            toUserId: String(ids.carol),
            callType: "audio",
            isGroupCall: false,
        });
        await carolIncomingAgain;
        const outcome = raceEvents(carol, ["call:joined", "call:answered-elsewhere", "call:unavailable"]);
        carol.emit("call:accept", { callId: oneToOneId });
        assert.equal((await outcome).event, "call:joined");

        // Ending a one-to-one call closes the room and leaves no claim behind for either side.
        const aliceSawEnd = waitFor(alice, "call:ended", { label: "Alice seeing the 1:1 call end" });
        carol.emit("call:end", { callId: oneToOneId });
        await aliceSawEnd;
        // call:ended reaches the other side before the room is torn down, so give it a moment.
        const gone = await waitUntil(async () => (await getRedis().get(`ciis:call:${oneToOneId}`)) === null);
        assert.equal(gone, true, "the room itself must be gone");
        assert.equal(await getRedis().get(`ciis:call:${oneToOneId}:answer:${ids.carol}`), null);
    });

    await t.test("the answer claim is released, so only live devices block a second accept", async () => {
        const probeCallId = `zztest-claim-${Date.now()}`;
        startedCallIds.push(probeCallId);
        assert.equal(await callStore.claimAnswer(probeCallId, String(ids.bob), "socket-1"), true);
        assert.equal(await callStore.claimAnswer(probeCallId, String(ids.bob), "socket-2"), false, "second device must lose the race");
        await callStore.releaseAnswer(probeCallId, String(ids.bob));
        assert.equal(await callStore.claimAnswer(probeCallId, String(ids.bob), "socket-3"), true, "after leaving, the same user must be able to claim again");
        await callStore.releaseAnswer(probeCallId, String(ids.bob));
    });
});
