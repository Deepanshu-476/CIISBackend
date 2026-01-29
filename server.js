const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const path = require("path");
const schedule = require('node-schedule');
const Task = require("./HR-CDS/models/Task"); // Import Task model for cron
const Notification = require("./HR-CDS/models/Notification"); // Import Notification model

dotenv.config();

const app = express();

// ✅ Trust proxy for production
app.set("trust proxy", 1);

// ✅ Connect MongoDB
connectDB();

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
          
          // Send notifications to assigned users
          for (const userId of task.assignedUsers) {
            try {
              await Notification.create({
                user: userId._id,
                title: 'Task Marked as Overdue',
                message: `Task "${task.title}" has been automatically marked as overdue.`,
                type: 'task_overdue',
                relatedTask: task._id,
                metadata: {
                  dueDate: task.dueDateTime,
                  taskTitle: task.title,
                  markedAt: new Date()
                }
              });
              notificationCount++;
            } catch (notifyError) {
              console.error(`Error creating notification for user ${userId._id}:`, notifyError);
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

// Schedule overdue check every 30 minutes
const overdueCheckJob = schedule.scheduleJob('*/30 * * * *', async () => {
  console.log('⏰ Running scheduled overdue tasks check...');
  await checkAndMarkOverdueTasks();
});

// Schedule daily summary at 9 AM
const dailySummaryJob = schedule.scheduleJob('0 9 * * *', async () => {
  console.log('⏰ Running daily overdue summary...');
  await dailyOverdueSummary();
});

// Run once on server start
setTimeout(async () => {
  console.log('🚀 Server started, running initial overdue check...');
  await checkAndMarkOverdueTasks();
}, 10000); // Wait 10 seconds after server starts

// Import models for attendance cron jobs
const Attendance = require("./HR-CDS/models/Attendance");
const User = require("./models/User");

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
        }
      }
    }
    
    console.log('✅ Daily absent marking completed');
  } catch (error) {
    console.error('❌ Error in absent marking job:', error);
  }
};

// Schedule daily job to run at 10:30 AM every day
const dailyAbsentJob = schedule.scheduleJob('30 10 * * *', async () => {
  console.log('⏰ Running scheduled daily absent marking...');
  await markDailyAbsent();
});

// Run once on server start to mark past absent records
setTimeout(() => {
  markPastAbsentRecords();
}, 15000); // Wait 15 seconds after server starts

// ==================== END OF CRON JOBS ====================

// ✅ CORS Configuration
app.use(
  cors({
    origin: ["https://cds.ciisnetwork.in",
      "http://localhost:5173",
      
      "http://147.93.106.84",
      "http://localhost:8080",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-JobRole", "X-User-Id"],
      exposedHeaders: [
    'Authorization',
    'X-User-JobRole',
    'X-User-Id'
  ]
  })
);

// ✅ Middleware
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/attendance", require("./HR-CDS/routes/attendanceRoutes"));
app.use("/api/leaves", require("./HR-CDS/routes/LeaveRoutes"));
app.use("/api/assets", require("./HR-CDS/routes/assetsRoute"));
app.use("/api/task", require("./HR-CDS/routes/taskRoute"));
app.use("/api/users", require("./HR-CDS/routes/userRoutes"));
app.use("/api/departments", require("./routes/Department.routes"))
app.use("/api/users/profile", require("./HR-CDS/routes/profileRoute"));
app.use("/api/alerts", require("./HR-CDS/routes/alertRoutes"));
app.use("/api/holidays", require("./HR-CDS/routes/Holiday"));
app.use("/api/groups", require("./HR-CDS/routes/groupRoutes"));
app.use("/api/projects", require("./HR-CDS/routes/projectRoutes"));
app.use("/api/notifications", require("./HR-CDS/routes/notificationRoutes"));
app.use("/api/clientsservice", require("./HR-CDS/routes/clientRoutes"));
app.use("/api/clienttasks", require("./HR-CDS/routes/clientTask"));
app.use('/api/menu-access', require("./routes/menuAccess"));
app.use('/api/menu-items', require("./routes/menuItems"));
app.use('/api/company', require("./routes/companyRoutes"));
app.use('/api/company-auth', require("./routes/companyRoutes"));


app.use('/api/super-admin', require("./routes/superAdmin"));
// ✅ Add Meeting Management Route
app.use("/api/meetings", require("./HR-CDS/routes/meetingRoutes"));

// ✅ Health check
app.get("/api", (req, res) => {
  res.json({ 
    message: "✅ API is live",
    status: "running",
    timestamp: new Date(),
    services: {
      task_overdue_cron: "active",
      attendance_cron: "active"
    }
  });
});

// ✅ Manual overdue check endpoint (for testing)
app.get("/api/manual-overdue-check", async (req, res) => {
  try {
    console.log('🔄 Manual overdue check triggered via API...');
    await checkAndMarkOverdueTasks();
    res.json({ 
      success: true, 
      message: "Manual overdue check completed",
      timestamp: new Date()
    });
  } catch (error) {
    console.error('❌ Error in manual overdue check:', error);
    res.status(500).json({ error: "Manual overdue check failed" });
  }
});

// ✅ 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: "🔴 Route not found" });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err);
  res.status(500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
});