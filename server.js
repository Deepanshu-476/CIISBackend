const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const path = require("path");
const schedule = require('node-schedule');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const { protect, restrictTo } = require("./middleware/authMiddleware");
    
dotenv.config();

const requiredEnvVars = ["JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

require('./services/subscriptionReminderService');
const { runWorkAnniversaryEmails } = require('./services/workAnniversaryService');
const { runAutoClockOutSweep } = require('./HR-CDS/cron/forceClockOut');
require('./HR-CDS/cron/recurringTasks');

const app = express();


const server = http.createServer(app);


app.set("trust proxy", 1);
app.disable("x-powered-by");

// Keep request profiling development-only so production logs and latency stay
// unchanged. The path intentionally excludes query strings and request data.
if (process.env.NODE_ENV === "development" || process.env.ENABLE_API_TIMING === "true") {
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const responseSize = res.getHeader("content-length");
      const sizeSuffix = responseSize ? ` size=${responseSize}b` : "";
      const endpoint = String(req.originalUrl || req.path).split("?", 1)[0];
      console.log(
        `[api-timing] ${req.method} ${endpoint} -> ${res.statusCode} ${durationMs.toFixed(1)}ms${sizeSuffix}`
      );
    });

    next();
  });
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
});


const dbConnectionPromise = connectDB();

const allowedOrigins = [
  "https://cds.ciisnetwork.in",
  "https://backendcds.ciisnetwork.in",
  "app://ciis",
  "capacitor://localhost",
  "ionic://localhost",
  "null"
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});


const Task = require("./HR-CDS/models/Task");
const Attendance = require("./HR-CDS/models/Attendance");
const Holiday = require("./HR-CDS/models/Holiday");
const User = require("./models/User");
require("./models/Company");
const {notifyDirectUsers, sendSystemNotification} = require("./HR-CDS/utils/systemNotificationService");
const {sendEmail} = require("./utils/sendEmail");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const INITIAL_DB_JOB_DELAY_MS = Number(process.env.INITIAL_DB_JOB_DELAY_MS || 60000);
const runningDbJobs = new Set();

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

const isDbReady = () => mongoose.connection.readyState === 1;

const isTransientMongoError = error => {
  const message = String(error?.message || '').toLowerCase();
  const transientNames = new Set([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
  ]);
  const transientCodes = new Set(['EPIPE', 'ECONNRESET', 'ETIMEDOUT']);
  const hasRetryableLabel =
    error?.hasErrorLabel?.('RetryableReadError') ||
    error?.hasErrorLabel?.('RetryableWriteError') ||
    error?.errorLabelSet?.has?.('RetryableReadError') ||
    error?.errorLabelSet?.has?.('RetryableWriteError');

  return transientNames.has(error?.name) ||
    transientCodes.has(error?.code) ||
    hasRetryableLabel ||
    message.includes('socket has been ended') ||
    message.includes('connection timed out') ||
    message.includes('server selection timed out') ||
    /\bconnection\b.*\btimed out\b/.test(message);
};

const runDbJobWithRetry = async (label, job, {retries = 2, delayMs = 1000} = {}) => {
  if (!isDbReady()) {
    console.warn(`⚠️ ${label} skipped: MongoDB not connected`, {
      readyState: mongoose.connection.readyState,
    });
    return null;
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await job();
    } catch (error) {
      if (!isTransientMongoError(error) || attempt > retries) {
        console.error(`❌ ${label} failed:`, error);
        return null;
      }

      console.warn(`⚠️ ${label} transient MongoDB error, retrying`, {
        attempt,
        retries,
        retryInMs: delayMs * attempt,
        message: error.message,
        code: error.code,
        readyState: mongoose.connection.readyState,
      });
      await sleep(delayMs * attempt);
    }
  }

  return null;
};

const runDbJobOnce = async (label, job, options) => {
  if (runningDbJobs.has(label)) {
    console.warn(`${label} skipped: previous run is still active`);
    return null;
  }

  runningDbJobs.add(label);
  try {
    return await runDbJobWithRetry(label, job, options);
  } catch (error) {
    console.error(`${label} crashed unexpectedly:`, error);
    return null;
  } finally {
    runningDbJobs.delete(label);
  }
};

const scheduleDbJob = (cronExpression, label, job, options) => {
  return schedule.scheduleJob(cronExpression, () => {
    runDbJobOnce(label, job, options);
  });
};

const getTaskCompanyCode = (task) => {
  const companyCode =
    task.companyCode ||
    task.createdBy?.companyCode ||
    task.createdBy?.company?.companyCode ||
    task.assignedUsers?.find((user) => user?.companyCode)?.companyCode ||
    task.assignedUsers?.find((user) => user?.company?.companyCode)?.company?.companyCode;

  return typeof companyCode === 'string' ? companyCode.trim().toUpperCase() : companyCode;
};

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatTaskDueDate = dueDateTime => {
  const dueDate = new Date(dueDateTime);
  if (Number.isNaN(dueDate.getTime())) return 'the scheduled due time';

  return dueDate.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: process.env.TZ || 'Asia/Kolkata',
  });
};

const buildPendingTaskReminderEmail = ({userName, taskTitle, dueDateText}) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937; padding: 20px;">
    <h2 style="margin: 0 0 12px; color: #111827;">Pending Task Reminder</h2>
    <p>Hello <strong>${escapeHtml(userName || 'User')}</strong>,</p>
    <p>Your task <strong>${escapeHtml(taskTitle)}</strong> is still pending.</p>
    <p>This is a reminder that the task is due at <strong>${escapeHtml(dueDateText)}</strong>. Please complete it before the due time.</p>
    <p style="margin-top: 20px;">Regards,<br/>CIIS Network</p>
    <p style="font-size: 12px; color: #6b7280;">This is an automated reminder. Please do not reply to this email.</p>
  </div>
`;



const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        void 0;
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], 
    allowedHeaders: ["Content-Type", "Authorization", "X-Permanent-Delete"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});


global.io = io;


const initializeSocket = require('./HR-CDS/socket/index.js');


initializeSocket(io);




const checkAndMarkOverdueTasks = async () => {
  try {
    void 0;
    
    const now = new Date();
    
    
    const overdueTasks = await Task.find({
      dueDateTime: { $lt: now },
      isActive: true,
      $or: [
        { overallStatus: { $in: ['pending', 'in-progress', 'reopen'] } },
        { 
          'statusByUser.status': { $in: ['pending', 'in-progress', 'reopen'] }
        }
      ]
    })
    .populate('assignedUsers', 'name email companyCode company')
    .populate('createdBy', 'name email companyCode company');
    
    void 0;
    
    let markedCount = 0;
    let notificationCount = 0;
    
    for (const task of overdueTasks) {
      try {
        const wasUpdated = task.checkAndMarkOverdue();
        
        if (wasUpdated) {
          if (!task.companyCode) {
            const companyCode = getTaskCompanyCode(task);
            if (!companyCode) {
              console.error(`❌ Cannot mark task ${task._id} overdue: companyCode is missing`);
              continue;
            }
            task.companyCode = companyCode;
          }

          await task.save();
          markedCount++;
          
          
          for (const assignedUser of task.assignedUsers) {
            try {
              
              const userId = assignedUser._id || assignedUser.id || assignedUser;
              
              if (!userId) {
                console.error('❌ Invalid user object:', assignedUser);
                continue;
              }

              void 0;

              await notifyDirectUsers({
                userIds: [userId],
                targetPath: '/ciisUser/task-management',
                title: 'Task Marked as Overdue',
                message: `Task "${task.title}" has been automatically marked as overdue.`,
                type: 'task_overdue',
                data: {
                  taskId: task._id,
                  taskTitle: task.title,
                  dueDate: task.dueDateTime,
                  markedAt: new Date()
                },
                priority: 'high',
              });
              
              notificationCount++;
              void 0;
            } catch (notifyError) {
              console.error(`❌ Error creating notification for user:`, notifyError.message);
            }
          }
        }
      } catch (taskError) {
        console.error(`Error processing task ${task._id}:`, taskError);
      }
    }
    
    void 0;
      
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Error in overdue tasks check:', error);
  }
};

const sendPendingTaskReminders = async () => {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const tasks = await Task.find({
      isActive: true,
      dueDateTime: {$gt: now, $lte: oneHourFromNow},
      'statusByUser.status': 'pending',
    })
      .populate('assignedUsers', 'name email')
      .select('title assignedUsers statusByUser dueDateTime');

    for (const task of tasks) {
      const dueDateText = formatTaskDueDate(task.dueDateTime);
      const dueTimestamp = new Date(task.dueDateTime).getTime();
      const usersById = new Map(
        (task.assignedUsers || []).map(user => [String(user._id || user.id || user), user])
      );
      const pendingStatuses = (task.statusByUser || []).filter(item => {
        if (item.status !== 'pending' || !item.user) return false;
        const reminderDueTimestamp = item.pendingDueReminderDueAt
          ? new Date(item.pendingDueReminderDueAt).getTime()
          : null;
        return reminderDueTimestamp !== dueTimestamp;
      });

      if (!pendingStatuses.length) continue;

      for (const statusItem of pendingStatuses) {
        const userId = statusItem.user.toString();
        const assignedUser = usersById.get(userId);

        try {
          await notifyDirectUsers({
            userIds: [userId],
            targetPath: '/ciisUser/task-management',
            type: 'task_pending_reminder',
            title: 'Pending Task Reminder',
            message: `Your task "${task.title}" is still pending. Please complete it before the due time.`,
            data: {taskId: task._id, taskTitle: task.title, dueDateTime: task.dueDateTime},
            priority: 'high',
          });

          if (assignedUser?.email) {
            await sendEmail(
              assignedUser.email,
              `Pending Task Reminder: ${task.title}`,
              buildPendingTaskReminderEmail({
                userName: assignedUser.name,
                taskTitle: task.title,
                dueDateText,
              }),
              {
                skipNotification: true,
                priority: 'high',
                text: `Hello ${assignedUser.name || 'User'}, your task "${task.title}" is still pending and is due at ${dueDateText}. Please complete it before the due time.`,
              }
            );
          }

          statusItem.pendingDueReminderSentAt = new Date();
          statusItem.pendingDueReminderDueAt = task.dueDateTime;
        } catch (reminderError) {
          console.error(`❌ Pending task reminder failed for task ${task._id} and user ${userId}:`, reminderError.message);
        }
      }

      await task.save();
    }
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Pending task reminder failed:'  , error.message);
  }
};

const sendTomorrowHolidayReminders = async () => {
  try {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    const holidays = await Holiday.find({
      isActive: true,
      date: {$gte: start, $lte: end},
    });

    for (const holiday of holidays) {
      const users = await User.find({
        company: holiday.company,
        isActive: true,
      }).select('_id');

      await sendSystemNotification({
        recipients: users.map(user => user._id),
        targetPath: '/ciisUser/user-dashboard',
        type: 'holiday_reminder',
        title: 'Holiday Tomorrow',
        message: `${holiday.title} is tomorrow`,
        company: holiday.company,
        data: {
          holidayId: holiday._id,
          title: holiday.title,
          date: holiday.date,
        },
        priority: 'medium',
      });
    }
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Holiday reminder failed:', error.message);
  }
};

const attendanceController = require("./HR-CDS/controllers/AttendanceController");


const dailyOverdueSummary = async () => {
  try {
    void 0;
    
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
      void 0;
    } else {
      void 0;
    }
    
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Error in daily summary cron job:', error);
  }
};


const markPastAbsentRecords = async () => {
  try {
    void 0;
    
    const users = await User.find({});
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30);
    
    for (const user of users) {
      
      const existingAttendances = await Attendance.find({ 
        user: user._id,
        date: { $gte: startDate, $lt: today }
      });
      
      
      const existingDates = new Set();
      existingAttendances.forEach(record => {
        const date = new Date(record.date);
        date.setHours(0, 0, 0, 0);
        existingDates.add(date.toISOString());
      });
      
      
      const currentDate = new Date(startDate);
      while (currentDate < today) {
        const dateStr = currentDate.toISOString();
        
        
        const dayOfWeek = currentDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const isHoliday = await Holiday.exists({
          companyCode: user.companyCode,
          isActive: true,
          date: { $gte: currentDate, $lt: nextDate }
        });
        
        
        if (!existingDates.has(dateStr) && !isWeekend && !isHoliday) {
          
          if (currentDate < today) {
            const absentRecord = new Attendance({
              user: user._id,
              date: new Date(currentDate),
              status: 'ABSENT',
              isClockedIn: false,
              notes: 'Auto-marked absent (no attendance recorded)'
            });
            
            await absentRecord.save();

            
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
    
    void 0;
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Error in past absent marking:', error);
  }
};


const markDailyAbsent = async () => {
  try {
    void 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today); 
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    
    const users = await User.find({});
    
    for (const user of users) {
      
      const existingAttendance = await Attendance.findOne({
        user: user._id,
        date: { $gte: today, $lt: tomorrow }
      });
      
      
      if (!existingAttendance) {
        const dayOfWeek = today.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = await Holiday.exists({
          companyCode: user.companyCode,
          isActive: true,
          date: { $gte: today, $lt: tomorrow }
        });
        
        // A company holiday must never be converted into an absent day.
        if (!isWeekend && !isHoliday) { 
          const absentRecord = new Attendance({
            user: user._id,
            date: today,
            status: 'ABSENT',
            isClockedIn: false,
            notes: 'Auto-marked absent (no attendance recorded today)'
          });
          
          await absentRecord.save();

          
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
    
    void 0;
  } catch (error) {
    if (isTransientMongoError(error)) throw error;
    console.error('❌ Error in absent marking job:', error);
  }
};




scheduleDbJob('*/30 * * * *', 'Scheduled overdue tasks check', checkAndMarkOverdueTasks);


scheduleDbJob('0 9 * * *', 'Daily overdue summary', dailyOverdueSummary);


scheduleDbJob('30 10 * * *', 'Daily absent marking', markDailyAbsent);

scheduleDbJob('* * * * *', 'Pending task reminders', sendPendingTaskReminders);

scheduleDbJob('0 18 * * *', 'Holiday reminders', sendTomorrowHolidayReminders);


setTimeout(async () => {
  try {
    await dbConnectionPromise;
    void 0;
    await runDbJobOnce('Initial overdue tasks check', checkAndMarkOverdueTasks, {
      retries: 4,
      delayMs: 5000,
    });
    await runDbJobOnce('Initial past absent records check', markPastAbsentRecords);
    await runDbJobOnce('Initial auto clock-out sweep', runAutoClockOutSweep);
    
    
    try {
      const backfillBranchSupport = require("./scripts/backfillBranchSupport");
      await runDbJobOnce('Multi-branch database backfill migration', backfillBranchSupport);
    } catch (migError) {
      console.error("❌ Failed to trigger multi-branch data migration:", migError.message);
    }
  } catch (error) {
    console.error("Initial background jobs failed:", error);
  }
}, INITIAL_DB_JOB_DELAY_MS);


const corsOptions = {
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      void 0;
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Permanent-Delete"]
};

app.use(cors(corsOptions));



const cookieParser = require("cookie-parser");
app.use(cookieParser());


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const uploadStaticDirs = [
  path.join(__dirname, "uploads"),
  path.join(__dirname, "HR-CDS", "uploads"),
];

uploadStaticDirs.forEach(uploadDir => {
  app.use("/api/uploads", express.static(uploadDir));
});
app.use(
    "/uploads",
    express.static(
        path.join(
            __dirname,
            "uploads"
        )
    )
);


app.use((req, res, next) => {
  const quietPaths = new Set([
    "/api/chat/users",
  ]);

  if (!quietPaths.has(req.originalUrl)) {
    void 0;
  }

  next();
});


const dashboardRoutes = require('./HR-CDS/routes/dashboardRoutes.js');



app.use("/api/auth", require("./routes/authRoutes.js"));
app.use("/api/app-version", require("./routes/appVersionRoutes.js"));
app.use("/api/attendance", require("./HR-CDS/routes/attendanceRoutes.js"));
app.use("/api/leaves", require("./HR-CDS/routes/LeaveRoutes.js"));
app.use("/api/asset-requests", require("./HR-CDS/routes/assetRequestRoutes.js"));
app.use("/api/task", require("./HR-CDS/routes/taskRoute.js"));
app.use("/api/users", require("./HR-CDS/routes/userRoutes.js"));
app.use("/api/departments", require("./routes/Department.routes.js"));
app.use("/api/users/profile", require("./HR-CDS/routes/profileRoute.js"));
app.use("/api/alerts", require("./HR-CDS/routes/alertRoutes.js"));
app.use("/api/notifications", require("./HR-CDS/routes/notificationRoutes.js"));
app.use("/api/feedback", require("./HR-CDS/routes/feedbackRoutes.js"));
app.use("/api/groups", require("./HR-CDS/routes/groupRoutes.js"));
app.use("/api/projects", require("./HR-CDS/routes/projectRoutes.js"));
app.use("/api/clientsservice", require("./HR-CDS/routes/clientRoutes.js"));
app.use("/api/client-plans", require("./HR-CDS/routes/clientPlanRoutes.js"));
app.use("/api/chat", require("./HR-CDS/chat/routes/chatRoutes"));

app.use("/api/tasks/self", require("./HR-CDS/routes/selfTaskRoute.js"));
app.use("/api/tasks/assigned", require("./HR-CDS/routes/assignedTaskRoute.js"));
app.use("/api/tasks/client-tasks", require("./HR-CDS/routes/clientTaskRoute.js"));
app.use("/api/tasks/project", require("./HR-CDS/routes/projectTaskRoute.js"));
app.use("/api/tasks/all", require("./HR-CDS/routes/allTaskRoute.js"));

// IMPORTANT: Client task routes are mounted here.
// This ensures that /api/tasks/... endpoints are available.
app.use("/api/tasks", require("./HR-CDS/routes/clientTask.js"));



app.use('/api/dashboard', dashboardRoutes);

app.use('/api/menu-access', require("./routes/menuAccess.js"));
app.use('/api/menu-items', require("./routes/menuItems.js"));
app.use('/api/page-permissions', require("./routes/pagePermissions.js"));
app.use('/api/company', require("./routes/companyRoutes.js"));
app.use('/api/plans', require("./routes/planRoutes.js"));
app.use('/api/job-roles', require("./routes/jobRoleRoutes.js"));
app.use('/api/superAdmin', require("./routes/superAdmin.js"));
app.use("/api/meetings", require("./HR-CDS/routes/meetingRoutes.js"));
app.use('/api/cmeeting', require("./HR-CDS/routes/clientMeetingRoutes.js"));
app.use('/api/sidebar', require("./routes/sidebarConfigs.js")); 
app.use('/api/company-assets', require('./routes/companyAssetRoutes'));
app.use("/api/holidays", require("./HR-CDS/routes/Holiday.js"));
app.use("/api/client-documents", require("./HR-CDS/routes/clientDocumentRoutes.js"));
app.use('/api/branches', require('./routes/branchRoutes.js'));
app.use('/api/support', require('./routes/supportRoutes.js'));
app.use('/api/email-settings', require('./routes/emailSettingsRoutes.js'));
app.use('/api/demo-requests', require('./routes/demoRequestRoutes.js'));
app.use('/api/leave-types', require('./routes/leaveTypeRoutes.js'));
app.use('/api/leave-policies', require('./routes/leavePolicyRoutes.js'));
app.use('/api/salary-components', require('./routes/salaryComponentRoutes.js'));
app.use('/api/salary-structures', require('./routes/salaryStructureRoutes.js'));
app.use('/api/employee-salaries', require('./routes/employeeSalaryRoutes.js'));




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


app.get("/api/socket-status", protect, restrictTo("super_admin"), sensitiveActionLimiter, (req, res) => {
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


app.get("/api/manual-overdue-check", protect, restrictTo("super_admin"), sensitiveActionLimiter, async (req, res) => {
  try {
    void 0;
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


app.get("/api/manual-attendance-check", protect, restrictTo("super_admin"), sensitiveActionLimiter, async (req, res) => {
  try {
    void 0;
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


app.get("/api/tasks/test", (req, res) => {
  res.json({
    success: true,
    message: "Tasks API is working",
    endpoints: {
      assignedToMe: "/api/tasks/assigned-to-me",
      clientTasks: "/api/tasks/client/:clientId",
      serviceTasks: "/api/tasks/client/:clientId/service/:service"
    },
    timestamp: new Date().toISOString()
  });
});




app.use((req, res) => {
  void 0;
  res.status(404).json({ 
    message: "Route not found",
    requested: `${req.method} ${req.originalUrl}`,
    available: "/api",
    timestamp: new Date().toISOString()
  });
});


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


const PORT = process.env.PORT || 3000;


server.listen(PORT, async () => {
  await dbConnectionPromise;

  // Temporarily enabled for work-anniversary email template testing.
  try {
    const anniversarySummary = await runWorkAnniversaryEmails();
    console.log("Startup work anniversary test completed:", anniversarySummary);
  } catch (err) {
    console.error("Startup work anniversary test failed:", err);
  }

  try {
    const migrateTenantIndexes = require("./utils/tenantIndexMigration");
    await migrateTenantIndexes();
  } catch (err) {
    console.error("Failed to migrate tenant indexes:", err);
  }

  
  try {
    const { initMeetingScheduler } = require("./services/meetingSchedulerService");
    initMeetingScheduler();
  } catch (err) {
    console.error("Failed to initialize meeting scheduler:", err);
  }

  void 0;
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("❌ Port already in use: " + PORT);
    process.exit(1);
  } else {
    console.error("Server error:", err);
  }
});
