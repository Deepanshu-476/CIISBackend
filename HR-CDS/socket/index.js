
const authSocket = require('../../middleware/authSocket');
const connectionHandler = require('../socket/handlers/connectionHandler');
const { leaveHandlers } = require('../socket/handlers/leaveHandlers');
const notificationHandlers = require('../socket/handlers/notificationHandlers');


const chatSocket = require("../chat/socket/chatSocket");
const callSocket = require("../chat/socket/callSocket");


const initializeSocket = (io) => {
  void 0;

  
  io.use(authSocket);

  io.on('connection', (socket) => {
    void 0;

    
    connectionHandler(io, socket);

    
    leaveHandlers(io, socket);
    notificationHandlers(io, socket);

    chatSocket(io, socket);
    callSocket(io, socket);

    
    
  });

  
  global.io = io;

  void 0;
  return io;
};

module.exports = initializeSocket;
