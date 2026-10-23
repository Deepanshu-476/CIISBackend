require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const User = require('../models/User');
const Task = require('../HR-CDS/models/Task');

async function runEndToEnd() {
    console.log('=== RUNNING REAL END-TO-END ATTACHMENT TEST ===');
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Find an active user in the database
    const user = await User.findOne({ isActive: true });
    if (!user) {
        throw new Error('No active user found in database');
    }
    console.log('Using User:', user.name, user.email, 'ID:', user._id.toString());

    // Generate JWT token for this user
    const token = jwt.sign(
        { id: user._id, userId: user._id, company: user.company, companyCode: user.companyCode },
        process.env.JWT_SECRET || 'supersecretkey',
        { expiresIn: '1h' }
    );

    // Setup Socket.IO client to listen for task:new
    let taskNewCount = 0;
    let receivedTask = null;

    const socketUrl = 'http://localhost:3000';
    const socket = io(socketUrl, {
        auth: { token },
        transports: ['websocket'],
    });

    await new Promise((resolve) => {
        socket.on('connect', () => {
            console.log('Socket connected with id:', socket.id);
            // Join user room
            socket.emit('join:user', { userId: user._id.toString() });
            socket.emit('setup', { _id: user._id.toString() });
            resolve();
        });
        setTimeout(resolve, 1500); // fallback if immediate
    });

    socket.on('task:new', (task) => {
        taskNewCount += 1;
        receivedTask = task;
        console.log(`[SOCKET EVENT] Received 'task:new' count=${taskNewCount}, Task ID:`, task._id || task.id);
    });

    // Create a temporary sample image file
    const tempImgPath = path.join(__dirname, 'test_sample.png');
    // Simple 1x1 png buffer
    const pngBuffer = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
        'hex'
    );
    fs.writeFileSync(tempImgPath, pngBuffer);

    // Build FormData exactly like AIChatDrawer.jsx handleConfirm
    const form = new FormData();
    form.append('title', 'Astra E2E Attachment Test Task');
    form.append('description', 'Verified via end-to-end automated runner');
    form.append('priority', 'high');
    form.append('priorityDays', '1');
    form.append('isSelfTask', 'true');
    form.append('dueDateTime', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    form.append('repeatPattern', 'none');
    form.append('checkpoints', JSON.stringify([{ title: 'E2E Checkpoint 1', completed: false }]));
    form.append('reminderSettings', JSON.stringify({ enabled: false, options: [] }));
    form.append('files', fs.createReadStream(tempImgPath), {
        filename: 'test_sample.png',
        contentType: 'image/png',
    });

    console.log('Submitting task via /api/tasks/self/create...');
    const response = await axios.post('http://localhost:3000/api/tasks/self/create', form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`,
        },
    });

    console.log('Endpoint responded with status:', response.status);
    const createdTask = response.data?.task;
    console.log('Created Task ID:', createdTask?._id);
    console.log('Task Files in Response:', createdTask?.files);

    // Wait for socket broadcast
    await new Promise((r) => setTimeout(r, 2000));

    console.log(`Total 'task:new' emissions received: ${taskNewCount}`);

    // Verify task in database directly
    const dbTask = await Task.findById(createdTask._id);
    console.log('Database Task found:', Boolean(dbTask));
    console.log('Database Task Files count:', dbTask?.files?.length);
    if (dbTask?.files?.length > 0) {
        console.log('File details in DB:', {
            filename: dbTask.files[0].filename,
            originalName: dbTask.files[0].originalName,
            path: dbTask.files[0].path,
        });
    }

    // Clean up temporary files
    try {
        fs.unlinkSync(tempImgPath);
    } catch {}

    // Clean up test task
    if (dbTask) {
        await Task.findByIdAndDelete(dbTask._id);
        console.log('Test task cleaned up from database.');
    }

    socket.disconnect();
    await mongoose.disconnect();

    if (response.status === 201 && dbTask?.files?.length === 1 && taskNewCount === 1) {
        console.log('\n✅ E2E ATTACHMENT TEST PASSED! Status 201, 1 file stored, task:new emitted exactly ONCE.');
    } else {
        console.log('\n⚠️ Check output: status:', response.status, 'files:', dbTask?.files?.length, 'emissions:', taskNewCount);
    }
}

runEndToEnd().catch((err) => {
    console.error('E2E Test Error:', err.response?.data || err.message || err);
    process.exit(1);
});
