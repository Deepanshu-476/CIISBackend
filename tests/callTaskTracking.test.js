const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");
const path = require("path");

const createMockSocket = (userId, socketId, companyId = "comp-1") => {
    const handlers = new Map();
    const emitted = [];
    const socket = {
        id: socketId,
        userId: String(userId),
        companyId: String(companyId),
        user: {
            _id: String(userId),
            id: String(userId),
            name: userId === "user-alice" ? "Alice" : "Bob",
            email: `${userId}@example.com`,
            companyCode: "CIIS",
        },
        data: {},
        on(event, fn) {
            handlers.set(event, fn);
        },
        emit(event, payload) {
            emitted.push({ target: socketId, event, payload });
        },
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ target: room, event, payload, broadcastFrom: socketId });
                },
            };
        },
        async trigger(event, data, cb) {
            const fn = handlers.get(event);
            assert.ok(fn, `Expected socket handler for ${event}`);
            return await fn(data, cb);
        },
    };
    return { socket, emitted };
};

test("callTaskService + callSocket: creates personal tasks for both users, tracks active time, and prompts only the active device socket", async (t) => {
    const createdTasks = [];
    const createdActivityLogs = [];
    const roomStore = new Map();
    const ioEmissions = [];

    const mockUsers = [
        { _id: "user-alice", name: "Alice", email: "alice@example.com", companyCode: "CIIS", branch: null },
        { _id: "user-bob", name: "Bob", email: "bob@example.com", companyCode: "CIIS", branch: null },
    ];

    const wrapTaskDoc = (doc) => ({
        ...doc,
        async save() {
            const idx = createdTasks.findIndex((item) => item._id === this._id);
            if (idx !== -1) createdTasks[idx] = this;
            return this;
        },
    });

    const TaskMock = {
        async create(data) {
            const doc = wrapTaskDoc({
                ...data,
                _id: `task-${createdTasks.length + 1}`,
                statusByUser: [...(data.statusByUser || [])],
                statusHistory: [...(data.statusHistory || [])],
            });
            createdTasks.push(doc);
            return doc;
        },
        async findById(id) {
            return createdTasks.find((item) => String(item._id) === String(id)) || null;
        },
    };

    const ActivityLogMock = {
        async create(data) {
            const doc = { ...data, _id: `log-${createdActivityLogs.length + 1}` };
            createdActivityLogs.push(doc);
            return doc;
        },
    };

    const UserMock = {
        find(query) {
            const ids = (query?._id?.$in || []).map(String);
            const result = mockUsers.filter((u) => !ids.length || ids.includes(String(u._id)));
            const chain = {
                select: () => chain,
                populate: () => chain,
                lean: async () => result,
            };
            return chain;
        },
        findOne() {
            const chain = {
                select: () => chain,
                lean: async () => ({ _id: "user-bob" }),
            };
            return chain;
        },
    };

    const callStoreMock = {
        async save(room) {
            roomStore.set(String(room.callId), JSON.parse(JSON.stringify(room)));
        },
        async get(callId) {
            const raw = roomStore.get(String(callId));
            return raw ? JSON.parse(JSON.stringify(raw)) : null;
        },
        async remove(callId) {
            roomStore.delete(String(callId));
        },
        async listAll() {
            return [...roomStore.values()];
        },
        async claimAnswer() {
            return true;
        },
        async releaseAnswer() {},
        async releaseAnswers() {},
        async withCallLock(_callId, fn) {
            return await fn();
        },
    };

    const callHistoryMock = {
        recordCallStarted: () => {},
        recordParticipantsAdded: () => {},
        recordCallAnswered: () => {},
        recordCallFinished: () => {},
    };

    const firebasePushMock = {
        sendPushToUsers: async () => {},
    };

    const presenceMock = {
        isUserOnline: () => true,
    };

    const ConversationMock = {
        exists: async () => false,
    };

    const originalLoad = Module._load;
    const callTaskServicePath = path.resolve(__dirname, "../HR-CDS/chat/utils/callTaskService.js");
    const callSocketPath = path.resolve(__dirname, "../HR-CDS/chat/socket/callSocket.js");
    delete require.cache[callTaskServicePath];
    delete require.cache[callSocketPath];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === "../../models/Task") return TaskMock;
        if (request === "../../models/ActivityLog") return ActivityLogMock;
        if (request === "../../../models/User") return UserMock;
        if (request === "../socket/callStore") return callStoreMock;
        if (request === "../utils/callHistory") return callHistoryMock;
        if (request === "../../utils/firebasePushService") return firebasePushMock;
        if (request === "../../socket/presence") return presenceMock;
        if (request === "../models/Conversation") return ConversationMock;
        return originalLoad.call(this, request, parent, isMain);
    };

    t.after(() => {
        Module._load = originalLoad;
        delete require.cache[callTaskServicePath];
        delete require.cache[callSocketPath];
    });

    const callSocket = require(callSocketPath);

    const io = {
        to(target) {
            return {
                emit(event, payload) {
                    ioEmissions.push({ target: String(target), event, payload });
                },
            };
        },
    };

    const runCallLifecycle = async ({ callId, callType, createTask, rejectBeforeAnswer = false }) => {
        ioEmissions.length = 0;
        const alice = createMockSocket("user-alice", `sock-web-alice-${callId}`);
        const bob = createMockSocket("user-bob", `sock-app-bob-${callId}`);

        callSocket(io, alice.socket);
        callSocket(io, bob.socket);

        await alice.socket.trigger("call:invite", {
            callId,
            toUserId: "user-bob",
            callType,
            createTask,
            callerUser: { _id: "user-alice", name: "Alice" },
        });

        if (rejectBeforeAnswer) {
            await bob.socket.trigger("call:reject", { callId, toUserId: "user-alice" });
            return { alice, bob };
        }

        await bob.socket.trigger("call:accept", { callId, callType });
        await new Promise((resolve) => setTimeout(resolve, 25));
        await bob.socket.trigger("call:end", { callId });
        return { alice, bob };
    };

    // 1. Video call WITH task creation
    await runCallLifecycle({ callId: "call-video-1", callType: "video", createTask: true });

    assert.equal(createdTasks.length, 2, "Should create 2 personal tasks (caller + receiver)");
    const aliceTask = createdTasks.find((task) => String(task.createdBy) === "user-alice");
    const bobTask = createdTasks.find((task) => String(task.createdBy) === "user-bob");

    assert.ok(aliceTask, "Caller personal task should exist");
    assert.ok(bobTask, "Receiver personal task should exist");
    assert.equal(aliceTask.taskFor, "self");
    assert.equal(bobTask.taskFor, "self");
    assert.match(aliceTask.title, /Called Bob \(Video Call\)/);
    assert.match(bobTask.title, /Attended call from Alice \(Video Call\)/);

    assert.equal(aliceTask.overallStatus, "completed");
    assert.equal(bobTask.overallStatus, "completed");
    assert.equal(aliceTask.statusHistory.length, 2);
    assert.equal(aliceTask.statusHistory[0].status, "in-progress");
    assert.equal(aliceTask.statusHistory[1].status, "completed");
    assert.ok(
        new Date(aliceTask.statusHistory[1].changedAt).getTime() >
            new Date(aliceTask.statusHistory[0].changedAt).getTime(),
        "Completed timestamp must be after in-progress start timestamp for active time tracking"
    );
    assert.equal(bobTask.statusHistory.length, 2);
    assert.equal(bobTask.statusHistory[0].status, "in-progress");
    assert.equal(bobTask.statusHistory[1].status, "completed");

    const remarkPrompts = ioEmissions.filter((e) => e.event === "call:task-remark-prompt");
    assert.equal(remarkPrompts.length, 2, "Both users should receive remark prompt");
    const alicePrompt = remarkPrompts.find((e) => e.payload.taskId === aliceTask._id);
    const bobPrompt = remarkPrompts.find((e) => e.payload.taskId === bobTask._id);
    assert.equal(alicePrompt.target, "sock-web-alice-call-video-1", "Caller prompt must go only to caller's active socket");
    assert.equal(bobPrompt.target, "sock-app-bob-call-video-1", "Receiver prompt must go only to receiver's active socket");
    assert.equal(alicePrompt.payload.callType, "video");
    assert.equal(bobPrompt.payload.callType, "video");

    // 2. Simple audio call WITH task creation
    await runCallLifecycle({ callId: "call-audio-1", callType: "audio", createTask: true });
    assert.equal(createdTasks.length, 4, "Should also create 2 personal tasks for audio call");
    const audioAliceTask = createdTasks[2];
    const audioBobTask = createdTasks[3];
    assert.match(audioAliceTask.title, /Called Bob \(Voice Call\)/);
    assert.match(audioBobTask.title, /Attended call from Alice \(Voice Call\)/);

    const audioRemarkPrompts = ioEmissions.filter((e) => e.event === "call:task-remark-prompt");
    assert.equal(audioRemarkPrompts.length, 2);
    assert.equal(audioRemarkPrompts[0].payload.callType, "audio");

    // 3. Call WITHOUT task creation (createTask: false)
    await runCallLifecycle({ callId: "call-no-task", callType: "video", createTask: false });
    assert.equal(createdTasks.length, 4, "Must not create tasks when createTask is false");
    assert.equal(ioEmissions.filter((e) => e.event === "call:task-remark-prompt").length, 0);

    // 4. Rejected/unanswered call with createTask: true
    await runCallLifecycle({ callId: "call-rejected", callType: "audio", createTask: true, rejectBeforeAnswer: true });
    assert.equal(createdTasks.length, 4, "Must not create tasks when call was never answered");
    assert.equal(ioEmissions.filter((e) => e.event === "call:task-remark-prompt").length, 0);
});
