const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const path = require("path");
const schedule = require('node-schedule');
const http = require('http');
const socketIo = require('socket.io');

dotenv.config();

const app = express();

// Create HTTP server
const server = http.createServer(app);

// ✅ Trust proxy for production
app.set("trust proxy", 1);

// ✅ Connect MongoDB
connectDB();

// ==================== IMPORT MODELS FOR CRON JOBS ====================
const Task = require("./HR-CDS/models/Task");
const Notification = require("./HR-CDS/models/Notification");
const Attendance = require("./HR-CDS/models/Attendance");
const User = require("./models/User");

// ==================== SOCKET.IO INITIALIZATION ====================
// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = [
        "https://cds.ciisnetwork.in",
        "http://localhost:5173",
        "http://localhost:5174", 
        "http://localhost:5175",
        "http://147.93.106.84",
        "http://localhost:8080"
      ];
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log(`❌ Socket CORS blocked: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], // ✅ Added all methods
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Make io globally available
global.io = io;

// ✅ FIXED: Correct path for socket initializer
const initializeSocket = require('./HR-CDS/socket/index.js');

// Initialize socket with our configuration
initializeSocket(io);

// ==================== TASK OVERDUE CRON JOBS ====================

// Function to check and mark overdue tasks
const checkAndMarkOverdueTasks = async () => {
  try {
    console.log('🔄 Running overdue tasks check...');
    
    const now = new Date();
    
    // Find tasks that are overdue but not marked yet
    const overdueTasks = await Task.find({
      dueDateTime: { $lt: now },
      isActive: true,
      $or: [
        { overallStatus: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] } },
        { 
          'statusByUser.status': { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
        }
      ]
    })
    .populate('assignedUsers', 'name email')
    .populate('createdBy', 'name email');
    
    console.log(`📊 Found ${overdueTasks.length} tasks to check for overdue...`);
    
    let markedCount = 0;
    let notificationCount = 0;
    
    for (const task of overdueTasks) {
      try {
        const wasUpdated = task.checkAndMarkOverdue();
        
        if (wasUpdated) {
          await task.save();
          markedCount++;
          
          // ✅ FIXED: Send notifications to assigned users with proper error handling
          for (const assignedUser of task.assignedUsers) {
            try {
              // Get user ID properly
              const userId = assignedUser._id || assignedUser.id || assignedUser;
              
              if (!userId) {
                console.error('❌ Invalid user object:', assignedUser);
                continue;
              }

              console.log(`📨 Creating notification for user: ${userId}`);

              // Create notification in database
              await Notification.create({
                recipient: userId, // ✅ Using 'recipient' field
                title: 'Task Marked as Overdue',
                message: `Task "${task.title}" has been automatically marked as overdue.`,
                type: 'task_overdue',
                data: {
                  taskId: task._id,
                  taskTitle: task.title,
                  dueDate: task.dueDateTime,
                  markedAt: new Date()
                }
              });
              
              notificationCount++;
              console.log(`✅ Notification created for user ${userId}`);

              // 🔔 Socket event for real-time notification
              if (global.io) {
                global.io.to(`user:${userId}`).emit('notification:new', {
                  type: 'task_overdue',
                  title: 'Task Marked as Overdue',
                  message: `Task "${task.title}" has been automatically marked as overdue.`,
                  data: {
                    taskId: task._id,
                    taskTitle: task.title,
                    dueDate: task.dueDateTime
                  }
                });
                console.log(`📢 Socket event sent to user:${userId}`);
              }
            } catch (notifyError) {
              console.error(`❌ Error creating notification for user:`, notifyError.message);
            }
          }
        }
      } catch (taskError) {
        console.error(`Error processing task ${task._id}:`, taskError);
      }
    }
    
    console.log(`✅ Overdue tasks check completed:
      • Tasks Checked: ${overdueTasks.length}
      • Marked Overdue: ${markedCount}
      • Notifications Sent: ${notificationCount}
      • Time: ${new Date().toLocaleString()}`);
      
  } catch (error) {
    console.error('❌ Error in overdue tasks check:', error);
  }
};

const attendanceController = require("./HR-CDS/controllers/AttendanceController");

// Function for daily summary
const dailyOverdueSummary = async () => {
  try {
    console.log('📊 Running daily overdue summary...');
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const overdueTasks = await Task.find({
      markedOverdueAt: { $gte: yesterday, $lt: today },
      isActive: true
    })
    .populate('assignedUsers', 'name email')
    .lean();
    
    if (overdueTasks.length > 0) {
      console.log(`📊 Daily Overdue Summary (${yesterday.toDateString()}):
        • New Overdue Tasks: ${overdueTasks.length}
        • Affected Users: ${[...new Set(overdueTasks.flatMap(t => t.assignedUsers.map(u => u.name)))].join(', ')}`);
    } else {
      console.log('📊 No new overdue tasks for yesterday.');
    }
    
  } catch (error) {
    console.error('❌ Error in daily summary cron job:', error);
  }
};

// Function to mark absent for past dates (last 30 days)
const markPastAbsentRecords = async () => {
  try {
    console.log('🔍 Checking for missing past attendance records...');
    
    const users = await User.find({});
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get last 30 days (excluding today)
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30);
    
    for (const user of users) {
      // Get existing attendance records for the user in last 30 days
      const existingAttendances = await Attendance.find({ 
        user: user._id,
        date: { $gte: startDate, $lt: today }
      });
      
      // Create a map of existing attendance dates
      const existingDates = new Set();
      existingAttendances.forEach(record => {
        const date = new Date(record.date);
        date.setHours(0, 0, 0, 0);
        existingDates.add(date.toISOString());
      });
      
      // Check each day from startDate to yesterday
      const currentDate = new Date(startDate);
      while (currentDate < today) {
        const dateStr = currentDate.toISOString();
        
        // Skip weekends
        const dayOfWeek = currentDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        // If no record exists and it's not a weekend, create absent record
        if (!existingDates.has(dateStr) && !isWeekend) {
          // Check if it's a future date (shouldn't happen, but just in case)
          if (currentDate < today) {
            const absentRecord = new Attendance({
              user: user._id,
              date: new Date(currentDate),
              status: 'ABSENT',
              isClockedIn: false,
              notes: 'Auto-marked absent (no attendance recorded)'
            });
            
            await absentRecord.save();

            // 🔔 Socket event for attendance notification
            if (global.io) {
              global.io.to(`user:${user._id}`).emit('attendance:marked', {
                type: 'attendance_absent',
                message: 'You were marked absent for ' + currentDate.toLocaleDateString(),
                data: {
                  date: currentDate,
                  status: 'ABSENT'
                }
              });
            }
          }
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    
    console.log('✅ Past absent marking completed');
  } catch (error) {
    console.error('❌ Error in past absent marking:', error);
  }
};

// Function to mark absent for today (for users who haven't clocked in by 10:00 AM)
const markDailyAbsent = async () => {
  try {
    console.log('🔍 Running daily absent marking job...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get all users
    const users = await User.find({});
    
    for (const user of users) {
      // Check if attendance exists for today
      const existingAttendance = await Attendance.findOne({
        user: user._id,
        date: { $gte: today, $lt: tomorrow }
      });
      
      // If no attendance exists, create absent record
      if (!existingAttendance) {
        const dayOfWeek = today.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        if (!isWeekend) {
          const absentRecord = new Attendance({
            user: user._id,
            date: today,
            status: 'ABSENT',
            isClockedIn: false,
            notes: 'Auto-marked absent (no attendance recorded today)'
          });
          
          await absentRecord.save();

          // 🔔 Socket event for today's absent marking
          if (global.io) {
            global.io.to(`user:${user._id}`).emit('attendance:marked', {
              type: 'attendance_absent',
              message: 'You have been marked absent for today',
              data: {
                date: today,
                status: 'ABSENT'
              }
            });
          }
        }
      }
    }
    
    console.log('✅ Daily absent marking completed');
  } catch (error) {
    console.error('❌ Error in absent marking job:', error);
  }
};

// ==================== SCHEDULE CRON JOBS ====================

// Schedule overdue check every 30 minutes
schedule.scheduleJob('*/30 * * * *', async () => {
  console.log('⏰ Running scheduled overdue tasks check...');
  await checkAndMarkOverdueTasks();
});

// Schedule daily summary at 9 AM
schedule.scheduleJob('0 9 * * *', async () => {
  console.log('⏰ Running daily overdue summary...');
  await dailyOverdueSummary();
});

// Schedule daily job to run at 10:30 AM every day
schedule.scheduleJob('30 10 * * *', async () => {
  console.log('⏰ Running scheduled daily absent marking...');
  await markDailyAbsent();
});

// Run initial checks on server start
setTimeout(async () => {
  console.log('🚀 Server started, running initial checks...');
  await checkAndMarkOverdueTasks();
  await markPastAbsentRecords();
}, 10000);

// ==================== CORS CONFIGURATION ====================
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "https://cds.ciisnetwork.in",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://147.93.106.84",
      "http://localhost:8080"
    ];
    
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`❌ CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-User-JobRole", "X-User-Id"],
  exposedHeaders: ['Authorization', 'X-User-JobRole', 'X-User-Id']
};

app.use(cors(corsOptions));

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ Request logging middleware (for debugging)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// ==================== ROUTES ====================
// ✅ Clean routes without duplicates
app.use("/api/auth", require("./routes/authRoutes.js"));
app.use("/api/attendance", require("./HR-CDS/routes/attendanceRoutes.js"));
app.use("/api/leaves", require("./HR-CDS/routes/LeaveRoutes.js"));
// 🔥 FIXED: Added missing closing parenthesis
app.use("/api/asset-requests", require("./HR-CDS/routes/assetRequestRoutes.js"));
app.use("/api/task", require("./HR-CDS/routes/taskRoute.js"));
app.use("/api/users", require("./HR-CDS/routes/userRoutes.js"));
app.use("/api/departments", require("./routes/Department.routes.js"));
app.use("/api/users/profile", require("./HR-CDS/routes/profileRoute.js"));
app.use("/api/alerts", require("./HR-CDS/routes/alertRoutes.js"));
app.use("/api/groups", require("./HR-CDS/routes/groupRoutes.js"));
app.use("/api/projects", require("./HR-CDS/routes/projectRoutes.js"));
app.use("/api/clientsservice", require("./HR-CDS/routes/clientRoutes.js"));
app.use("/api/clienttasks", require("./HR-CDS/routes/clientTask.js"));
app.use('/api/menu-access', require("./routes/menuAccess.js"));
app.use('/api/menu-items', require("./routes/menuItems.js"));
app.use('/api/company', require("./routes/companyRoutes.js"));
app.use('/api/job-roles', require("./routes/jobRoleRoutes.js"));
app.use('/api/superAdmin', require("./routes/superAdmin.js"));
app.use("/api/meetings", require("./HR-CDS/routes/meetingRoutes.js"));
app.use('/api/cmeeting', require("./HR-CDS/routes/clientMeetingRoutes.js"));
app.use('/api/sidebar', require("./routes/sidebarConfigs.js"));
app.use('/api/company-assets', require('./routes/companyAssetRoutes'));
app.use("/api/holidays", require("./HR-CDS/routes/Holiday.js"));

// ==================== API ENDPOINTS ====================

// ✅ Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to CDS Management System API",
    version: "1.0.0",
    status: "active",
    basePath: "/api",
    socket: global.io ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

// ✅ Health check
app.get("/api", (req, res) => {
  res.json({ 
    message: "✅ API is live",
    status: "running",
    socket: global.io ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    services: {
      task_overdue_cron: "active",
      attendance_cron: "active",
      socket_io: global.io ? "active" : "inactive",
      database: "MongoDB connected"
    }
  });
});

// ✅ Socket.IO status endpoint
app.get("/api/socket-status", (req, res) => {
  try {
    const socketStatus = {
      initialized: !!global.io,
      connections: global.io?.engine?.clientsCount || 0,
      rooms: global.io?.sockets?.adapter?.rooms?.size || 0
    };
    
    res.json({
      success: true,
      data: socketStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ Manual overdue check endpoint (for testing)
app.get("/api/manual-overdue-check", async (req, res) => {
  try {
    console.log('🔄 Manual overdue check triggered via API...');
    await checkAndMarkOverdueTasks();
    res.json({ 
      success: true, 
      message: "Manual overdue check completed",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in manual overdue check:', error);
    res.status(500).json({ error: "Manual overdue check failed" });
  }
});

// ✅ Manual attendance check endpoint
app.get("/api/manual-attendance-check", async (req, res) => {
  try {
    console.log('🔄 Manual attendance check triggered via API...');
    await markDailyAbsent();
    res.json({ 
      success: true, 
      message: "Manual attendance check completed",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in manual attendance check:', error);
    res.status(500).json({ error: "Manual attendance check failed" });
  }
});

// ==================== ERROR HANDLERS ====================

// ✅ 404 Handler - Improved
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: "Route not found",
    requested: `${req.method} ${req.originalUrl}`,
    available: "/api",
    timestamp: new Date().toISOString()
  });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method
  });
  
  res.status(err.status || 500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;

// Use server.listen instead of app.listen
server.listen(PORT, () => {
  console.log(`
🚀 ====================================
✅ Server running on port ${PORT}
✅ Environment: ${process.env.NODE_ENV || 'development'}
✅ MongoDB: Connected
✅ Socket.IO: Initialized
✅ Cron Jobs: Scheduled
✅ Time: ${new Date().toLocaleString()}
✅ Base URL: http://localhost:${PORT}/api
✅ Socket URL: ws://localhost:${PORT}
========================================
  `);
});