// socket/index.js
const authSocket = require('../../middleware/authSocket');
const connectionHandler = require('../socket/handlers/connectionHandler');
const { leaveHandlers } = require('../socket/handlers/leaveHandlers');
const notificationHandlers = require('../socket/handlers/notificationHandlers');
// const taskHandlers = require('../socket/handlers/');
// const attendanceHandlers = require('../socket/handlers/');

const initializeSocket = (io) => {
  console.log('🔄 Initializing Socket.IO...');

  // Apply authentication middleware
  io.use(authSocket);

  io.on('connection', (socket) => {
    console.log(`🔌 New socket connection: ${socket.id}`);

    // Handle basic connection
    connectionHandler(io, socket);

    // Register all handlers
    leaveHandlers(io, socket);
    notificationHandlers(io, socket);
    // taskHandlers(io, socket);
    // attendanceHandlers(io, socket);
  });

  // Make io globally available for controllers
  global.io = io;

  console.log('✅ Socket.IO initialized successfully');
  return io;
};

module.exports = initializeSocket;