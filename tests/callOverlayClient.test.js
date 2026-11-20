/**
 * The real web CallOverlay component, driven in node, against the real call handlers.
 *
 * The sibling suite (callReinviteScreenShare) proves the SERVER rings and accepts correctly; this
 * one proves the CLIENT does, because the original complaint was client-visible: the phone rang and
 * then the overlay dismissed itself with "Answered on another device". Here the component is mounted
 * for real, the Accept button is actually clicked, and the call is checked on the server afterwards.
 *
 * It needs, and otherwise skips:
 *   - a throwaway mongod (see callReinviteScreenShare.test.js); TEST_MONGO_URI to override;
 *   - the web repo next to this one (../CIIS), for the component and its esbuild;
 *   - jsdom, which neither repo installs: install it anywhere and pass JSDOM_PATH=<path to it>,
 *     or install it into either repo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const WEB = path.join(BACKEND, '..', 'CIIS');
const MONGO = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27030/ciiscalltest';
const PORT = Number(process.env.CALL_CLIENT_TEST_PORT) || 4788;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'call-client-test-secret';
process.env.CALL_RING_TIMEOUT_MS = '60000';

const canReach = (host, port) => new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1200);
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    socket.on('timeout', () => done(false));
});

const findJsdom = () => {
    const candidates = [
        process.env.JSDOM_PATH,
        path.join(WEB, 'node_modules/jsdom'),
        path.join(BACKEND, 'node_modules/jsdom'),
    ].filter(Boolean);
    for (const candidate of candidates) {
        try { return require(candidate); } catch { /* try the next one */ }
    }
    return null;
};

/** Bundles the real component (and one React instance) into a CommonJS file node can require. */
const buildOverlayBundle = () => {
    const esbuild = path.join(WEB, 'node_modules/.bin/esbuild');
    if (!fs.existsSync(esbuild)) return null;
    // esbuild resolves bare imports from the importing file's folder, so the entry lives in the web src.
    const entry = path.join(WEB, 'src', `zz-call-client-entry-${process.pid}.jsx`);
    const outfile = path.join(os.tmpdir(), `zz-calloverlay-${process.pid}.cjs`);
    fs.writeFileSync(entry, [
        'import React from "react";',
        'import { createRoot } from "react-dom/client";',
        'import { act } from "react-dom/test-utils";',
        'import CallOverlay from "./chat/CallOverlay";',
        'export { React, createRoot, act, CallOverlay };',
        '',
    ].join('\n'));
    try {
        execFileSync(esbuild, [
            entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
            '--loader:.css=empty', '--loader:.svg=empty', '--loader:.png=empty',
            `--define:import.meta.env={"VITE_API_URL":"http://127.0.0.1:${PORT}/api","MODE":"test"}`,
            '--define:process.env.NODE_ENV="development"',
            `--outfile=${outfile}`,
        ], { cwd: WEB, stdio: 'pipe' });
        return outfile;
    } finally {
        fs.rmSync(entry, { force: true });
    }
};

/** A browser good enough for the call overlay: media, WebRTC and audio are stubs. */
const setUpBrowser = (JSDOM) => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: 'http://localhost/',
        pretendToBeVisual: true,
    });
    global.window = dom.window;
    global.document = dom.window.document;
    // Node 21+ ships its own read-only `navigator`, so a plain assignment is silently ignored and
    // the component would see no mediaDevices ("not supported in this browser").
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Node = dom.window.Node;
    global.Event = dom.window.Event;
    global.MouseEvent = dom.window.MouseEvent;
    global.getComputedStyle = dom.window.getComputedStyle;
    global.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 16);
    global.cancelAnimationFrame = id => clearTimeout(id);
    global.localStorage = dom.window.localStorage;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    dom.window.IS_REACT_ACT_ENVIRONMENT = true;

    const track = kind => ({ kind, enabled: true, stop() {}, addEventListener() {}, removeEventListener() {} });
    const stream = () => {
        const tracks = [track('audio')];
        return {
            id: 'zz-stream',
            getTracks: () => tracks,
            getAudioTracks: () => tracks.filter(item => item.kind === 'audio'),
            getVideoTracks: () => tracks.filter(item => item.kind === 'video'),
            addTrack() {}, removeTrack() {},
        };
    };
    dom.window.navigator.mediaDevices = {
        getUserMedia: async () => stream(),
        getDisplayMedia: async () => stream(),
        enumerateDevices: async () => [],
    };
    class FakePeerConnection {
        constructor() { this.localDescription = null; this.remoteDescription = null; this.iceConnectionState = 'new'; this.connectionState = 'new'; }
        addTrack() { return {}; }
        getSenders() { return []; }
        getReceivers() { return []; }
        addEventListener() {}
        removeEventListener() {}
        async createOffer() { return { type: 'offer', sdp: 'zz' }; }
        async createAnswer() { return { type: 'answer', sdp: 'zz' }; }
        async setLocalDescription(description) { this.localDescription = description; }
        async setRemoteDescription(description) { this.remoteDescription = description; }
        async addIceCandidate() {}
        async getStats() { return new Map(); }
        close() {}
        restartIce() {}
    }
    dom.window.RTCPeerConnection = FakePeerConnection;
    global.RTCPeerConnection = FakePeerConnection;
    dom.window.RTCSessionDescription = value => value;
    dom.window.RTCIceCandidate = value => value;
    dom.window.AudioContext = class {
        constructor() { this.state = 'running'; this.destination = {}; }
        createAnalyser() { return { connect() {}, disconnect() {}, frequencyBinCount: 8, getByteFrequencyData() {} }; }
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createOscillator() { return { connect() {}, disconnect() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() {}, stop() {} }; }
        createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
        close() {}
        resume() {}
    };
    dom.window.webkitAudioContext = dom.window.AudioContext;
    dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    dom.window.HTMLMediaElement.prototype.pause = () => {};
    return dom;
};

test('the web call overlay rings, accepts and can be rung again', async t => {
    const mongoPort = Number(new URL(MONGO.replace('mongodb://', 'http://')).port || 27017);
    if (!(await canReach('127.0.0.1', mongoPort))) {
        t.skip(`Local mongod not reachable (${MONGO}) — skipping`);
        return;
    }
    if (!fs.existsSync(path.join(WEB, 'src/chat/CallOverlay.jsx'))) {
        t.skip('The web repo (../CIIS) is not next to this one — skipping');
        return;
    }
    const jsdomModule = findJsdom();
    if (!jsdomModule) {
        t.skip('jsdom not found (set JSDOM_PATH or install it) — skipping');
        return;
    }
    const bundlePath = buildOverlayBundle();
    if (!bundlePath) {
        t.skip('esbuild not found in the web repo — skipping');
        return;
    }

    const dom = setUpBrowser(jsdomModule.JSDOM);
    assert.equal(Boolean(navigator.mediaDevices?.getUserMedia), true, 'the media stub must take effect');
    const { React, createRoot, act, CallOverlay } = require(bundlePath);

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const flush = async (ms = 50) => { await act(async () => { await sleep(ms); }); };
    const buttonByTitle = title => [...document.querySelectorAll('button')].find(node => node.getAttribute('title') === title);
    const waitFor = async (predicate, { timeout = 8000, label = 'condition' } = {}) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (await predicate()) return true;
            await flush(50);
        }
        throw new Error(`Timed out waiting for ${label}`);
    };
    const click = async title => {
        const button = buttonByTitle(title);
        assert.equal(Boolean(button), true, `no "${title}" button on screen`);
        await act(async () => {
            button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
            await sleep(400);
        });
    };

    const mongoose = require(path.join(BACKEND, 'node_modules/mongoose'));
    const jwt = require(path.join(BACKEND, 'node_modules/jsonwebtoken'));
    const { Server } = require(path.join(BACKEND, 'node_modules/socket.io'));
    const ioClient = require(path.join(BACKEND, 'node_modules/socket.io-client'));

    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 4000 });
    const User = require(path.join(BACKEND, 'models/User'));
    const Company = require(path.join(BACKEND, 'models/Company'));
    const callStore = require(path.join(BACKEND, 'HR-CDS/chat/socket/callStore'));
    const redis = require(path.join(BACKEND, 'HR-CDS/socket/redis'));
    const authSocket = require(path.join(BACKEND, 'middleware/authSocket'));
    const callSocket = require(path.join(BACKEND, 'HR-CDS/chat/socket/callSocket'));

    const companyId = new mongoose.Types.ObjectId();
    const ids = {
        alice: new mongoose.Types.ObjectId(),
        bob: new mongoose.Types.ObjectId(),
        carol: new mongoose.Types.ObjectId(),
    };
    const tag = `ZZCLIENT-${Date.now()}`;
    const dropTestDocs = async () => {
        await Company.collection.deleteMany({ companyName: /^ZZCLIENT/ }).catch(() => {});
        await User.collection.deleteMany({ email: /^zzclient-/ }).catch(() => {});
    };
    await dropTestDocs();
    await Company.collection.insertOne({ _id: companyId, companyName: `${tag} Co`, companyCode: 'ZZCLIENT', isActive: true });
    await User.collection.insertMany([
        { _id: ids.alice, name: 'ZZ Alice', email: `zzclient-alice-${tag}@example.com`, company: companyId, companyCode: 'ZZCLIENT', isActive: true },
        { _id: ids.bob, name: 'ZZ Bob', email: `zzclient-bob-${tag}@example.com`, company: companyId, companyCode: 'ZZCLIENT', isActive: true },
        { _id: ids.carol, name: 'ZZ Carol', email: `zzclient-carol-${tag}@example.com`, company: companyId, companyCode: 'ZZCLIENT', isActive: true },
    ]);

    // The component fetches TURN credentials before accepting, so this server answers that call;
    // with no reply the accept would sit there waiting, which is what a real outage looks like.
    const httpServer = http.createServer((req, res) => {
        if (req.url && req.url.startsWith('/api/chat/turn-credentials')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ urls: ['stun:stun.l.google.com:19302'] }]));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
    });
    const io = new Server(httpServer, { cors: { origin: '*' } });
    io.use(authSocket);
    io.on('connection', socket => {
        socket.join(`user:${socket.userId}`);
        if (socket.companyId) socket.join(`company:${socket.companyId}`);
        callSocket(io, socket);
    });
    global.io = io;
    await new Promise(resolve => httpServer.listen(PORT, resolve));

    const tokenFor = id => jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const connect = id => new Promise((resolve, reject) => {
        const client = ioClient(`http://127.0.0.1:${PORT}`, { auth: { token: tokenFor(id) }, transports: ['websocket'], reconnection: false });
        client.on('connect', () => resolve(client));
        client.on('connect_error', reject);
    });

    const aliceSocket = await connect(ids.alice);   // the caller, a plain client
    const carolSocket = await connect(ids.carol);   // a second participant, keeps the call going
    const bobSocket = await connect(ids.bob);       // the component's own socket
    const callId = `${ids.alice}-${Date.now()}`;
    let root = null;
    // jsdom, the component's own timers and socket.io leave handles behind, so the file would sit
    // there until the runner's timeout. The hook below exits once the work is done, with the exit
    // code the result deserves.
    let failure = null;

    t.after(async () => {
        try {
            if (root) await act(async () => { root.unmount(); await sleep(50); });
            [aliceSocket, bobSocket, carolSocket].forEach(client => client.close());
            await callStore.remove(callId, Object.values(ids).map(String)).catch(() => {});
            await dropTestDocs();
        } finally {
            io.close();
            await new Promise(resolve => httpServer.close(resolve));
            await redis.closeRedisAdapter().catch(() => {});
            await mongoose.disconnect().catch(() => {});
            fs.rmSync(bundlePath, { force: true });
            // jsdom keeps its own timers and window alive; without this they outlive the test.
            try { dom.window.close(); } catch { /* already gone */ }
            if (process.env.CALL_CLIENT_TEST_DEBUG_HANDLES) {
                console.log('active resources:', JSON.stringify(process.getActiveResourcesInfo()));
            }
            if (!process.env.CALL_CLIENT_TEST_NO_EXIT) {
                process.exit(failure ? 1 : 0);
            }
        }
    });

    try {
    await act(async () => {
        root = createRoot(document.getElementById('root'));
        root.render(React.createElement(CallOverlay, {
            socket: bobSocket,
            currentUser: { _id: String(ids.bob), name: 'ZZ Bob', companyCode: 'ZZCLIENT' },
            onCallEvent: () => {},
        }));
        await sleep(200);
    });
    assert.equal(Boolean(buttonByTitle('Accept call')), false, 'nothing should be on screen before a call');

    // ---- Alice calls Bob and Carol; Carol answers so the call stays alive -------------------
    const carolJoined = new Promise(resolve => carolSocket.once('call:joined', resolve));
    carolSocket.once('call:incoming', () => carolSocket.emit('call:accept', { callId }));
    aliceSocket.emit('call:invite', {
        callId,
        conversationId: String(new mongoose.Types.ObjectId()),
        participantIds: [String(ids.bob), String(ids.carol)],
        callType: 'video',
        isGroupCall: true,
        groupTitle: 'ZZ Client Test',
    });
    await carolJoined;

    await waitFor(() => Boolean(buttonByTitle('Accept call')), { label: "Bob's incoming call screen" });
    assert.match(document.body.textContent || '', /ZZ Client Test|ZZ Alice/, 'the caller should be named on screen');

    await click('Accept call');
    await waitFor(async () => {
        const room = await callStore.get(callId);
        return room?.participants?.[String(ids.bob)]?.status === 'joined';
    }, { label: 'the server to see Bob as joined' });
    assert.equal(Boolean(buttonByTitle('End call')), true, 'the overlay should switch to the in-call screen');
    assert.equal(Boolean(buttonByTitle('Accept call')), false, 'the incoming screen should be gone');

    const aliceMic = () => [...document.querySelectorAll('.call-remote-tile')]
        .find(tile => tile.textContent.includes('ZZ Alice'))?.querySelector('.call-pill-mic');
    aliceSocket.emit('call:mic-state', { callId, muted: true });
    await waitFor(() => aliceMic()?.getAttribute('title') === 'Muted', { label: "Alice's muted video badge" });
    aliceSocket.emit('call:mic-state', { callId, muted: false });
    await waitFor(() => aliceMic()?.getAttribute('title') === 'Microphone active', { label: "Alice's unmuted video badge" });

    const bobMuteUpdate = new Promise(resolve => {
        const checkMute = data => {
            if (!data.participants.some(p => p.userId === String(ids.bob) && p.muted === true)) return;
            carolSocket.off('call:roster', checkMute);
            resolve(data);
        };
        carolSocket.on('call:roster', checkMute);
    });
    await click('Mute');
    await bobMuteUpdate;
    assert.ok(buttonByTitle('Unmute'), "Bob's local mute control should agree with Carol's roster");

    // ---- Bob leaves: this is where the old bug started --------------------------------------
    await click('End call');
    await flush(250);
    let room = await callStore.get(callId);
    assert.equal(room?.participants?.[String(ids.bob)]?.status, 'ended', 'leaving marks him ended, the call goes on');

    // ---- "Call again" from inside the call, which reuses the same callId --------------------
    const dismissals = [];
    bobSocket.on('call:answered-elsewhere', data => dismissals.push(data));
    aliceSocket.emit('call:add-participants', {
        callId,
        participantIds: [String(ids.bob)],
        callType: 'video',
        isGroupCall: true,
    });
    await waitFor(() => Boolean(buttonByTitle('Accept call')), { label: "Bob's second ring (Call again)" });

    await click('Accept call');
    await waitFor(async () => {
        const latest = await callStore.get(callId);
        return latest?.participants?.[String(ids.bob)]?.status === 'joined';
    }, { label: 'the second accept to join' });
    assert.equal(dismissals.length, 0, 'the overlay must not be dismissed with "answered on another device"');
    assert.equal(Boolean(buttonByTitle('End call')), true, 'the in-call screen should be showing again');

    // ---- and the ongoing-call Join path ------------------------------------------------------
    await click('End call');
    await flush(250);
    const rejoined = await new Promise(resolve => bobSocket.emit('call:rejoin', { callId }, resolve));
    assert.equal(rejoined?.success, true, `rejoin failed: ${rejoined?.message}`);
    room = await callStore.get(callId);
    assert.equal(room?.participants?.[String(ids.bob)]?.status, 'joined', 'after Join he is in the call again');
    } catch (error) {
        failure = error;
        throw error;
    }
});
