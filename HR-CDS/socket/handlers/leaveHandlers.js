


const emitLeaveEvents = {
  
  newLeaveApplied: (io, data) => {
    try {
      const { companyId, leave } = data;
      
      if (!io) {
        void 0;
        return;
      }

      
      io.to(`company:${companyId}:admin`).emit('leave:new', {
        type: 'leave_applied',
        message: `New leave application from ${leave.user?.name || 'Unknown'}`,
        data: leave,
        timestamp: new Date()
      });

      void 0;
    } catch (error) {
      console.error('❌ Error in newLeaveApplied event:', error);
    }
  },

  
  leaveStatusChanged: (io, data) => {
    try {
      const { leave, oldStatus, newStatus, updatedBy } = data;
      
      if (!io || !leave || !leave._id) {
        void 0;
        return;
      }

      
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

      void 0;
    } catch (error) {
      console.error('❌ Error in leaveStatusChanged event:', error);
    }
  },

  
  leaveDeleted: (io, data) => {
    try {
      const { leaveId, userId, deletedBy, leaveData } = data;
      
      if (!io || !userId) {
        void 0;
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

      void 0;
    } catch (error) {
      console.error('❌ Error in leaveDeleted event:', error);
    }
  }
};


const leaveHandlers = (io, socket) => {
  
  
  socket.on('leave:join', (leaveId) => {
    if (!leaveId) return;
    const room = `leave:${leaveId}`;
    socket.join(room);
    void 0;
  });

  
  socket.on('leave:leave', (leaveId) => {
    if (!leaveId) return;
    const room = `leave:${leaveId}`;
    socket.leave(room);
    void 0;
  });

  
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
