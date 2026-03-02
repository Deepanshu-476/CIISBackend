// socket/handlers/leaveHandlers.js

// Socket events for leave management
const emitLeaveEvents = {
  // Jab naya leave apply ho
  newLeaveApplied: (io, data) => {
    try {
      const { companyId, leave } = data;
      
      if (!io) {
        console.log('⚠️ Socket.io not initialized');
        return;
      }

      // Company ke sabhi admins/owners ko bhejo
      io.to(`company:${companyId}:admin`).emit('leave:new', {
        type: 'leave_applied',
        message: `New leave application from ${leave.user?.name || 'Unknown'}`,
        data: leave,
        timestamp: new Date()
      });

      console.log(`📢 Emitted leave:new to company:${companyId}:admin`);
    } catch (error) {
      console.error('❌ Error in newLeaveApplied event:', error);
    }
  },

  // Jab leave status change ho
  leaveStatusChanged: (io, data) => {
    try {
      const { leave, oldStatus, newStatus, updatedBy } = data;
      
      if (!io || !leave || !leave._id) {
        console.log('⚠️ Invalid data for leaveStatusChanged');
        return;
      }

      // Specific leave room mein sabko bhejo
      io.to(`leave:${leave._id}`).emit('leave:status_changed', {
        type: 'leave_status_changed',
        message: `Leave status changed from ${oldStatus} to ${newStatus}`,
        data: {
          leaveId: leave._id,
          oldStatus,
          newStatus,
          updatedBy: updatedBy?.name || 'System',
          remarks: leave.remarks,
          leave: leave
        },
        timestamp: new Date()
      });

      // User ko personally bhejo
      if (leave.user && leave.user._id) {
        io.to(`user:${leave.user._id}`).emit('notification:new', {
          type: 'leave_status_changed',
          title: `Leave ${newStatus}`,
          message: `Your leave has been ${newStatus}`,
          data: { 
            leaveId: leave._id, 
            status: newStatus,
            oldStatus: oldStatus
          }
        });
      }

      console.log(`📢 Emitted leave:status_changed for leave ${leave._id}`);
    } catch (error) {
      console.error('❌ Error in leaveStatusChanged event:', error);
    }
  },

  // Jab leave delete ho
  leaveDeleted: (io, data) => {
    try {
      const { leaveId, userId, deletedBy, leaveData } = data;
      
      if (!io || !userId) {
        console.log('⚠️ Invalid data for leaveDeleted');
        return;
      }

      io.to(`user:${userId}`).emit('leave:deleted', {
        type: 'leave_deleted',
        message: 'Your leave has been deleted',
        data: { 
          leaveId, 
          deletedBy: deletedBy?.name || 'Owner',
          leaveData: leaveData || {}
        },
        timestamp: new Date()
      });

      console.log(`📢 Emitted leave:deleted for user ${userId}`);
    } catch (error) {
      console.error('❌ Error in leaveDeleted event:', error);
    }
  }
};

// Client-side event handlers (jo frontend se aayenge)
const leaveHandlers = (io, socket) => {
  
  // Join specific leave room
  socket.on('leave:join', (leaveId) => {
    if (!leaveId) return;
    const room = `leave:${leaveId}`;
    socket.join(room);
    console.log(`📌 User ${socket.userId} joined leave room: ${room}`);
  });

  // Leave a specific leave room
  socket.on('leave:leave', (leaveId) => {
    if (!leaveId) return;
    const room = `leave:${leaveId}`;
    socket.leave(room);
    console.log(`📌 User ${socket.userId} left leave room: ${room}`);
  });

  // Request leave details
  socket.on('leave:get', async (leaveId, callback) => {
    try {
      const Leave = require('../../HR-CDS/models/Leave');
      const leave = await Leave.findById(leaveId)
        .populate('user', 'name email department')
        .populate('approvedBy', 'name email');
      
      if (callback && typeof callback === 'function') {
        callback({ success: true, data: leave });
      }
    } catch (error) {
      console.error('Error fetching leave:', error);
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });
};

module.exports = { leaveHandlers, emitLeaveEvents };