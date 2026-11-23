const Task = require('../../HR-CDS/models/Task');
const User = require('../../models/User');
const Attendance = require('../../HR-CDS/models/Attendance');

const performanceTools = [
  {
    name: 'get_employee_performance',
    description: 'Calculates performance score, task completion rate, overdue tasks, and punctuality for an employee. GATED: Requires HR / Manager / Admin access.',
    parameters: {
      type: 'object',
      properties: {
        employeeNameOrEmail: { type: 'string', description: 'Name or email of the employee' },
        timeframeDays: { type: 'number', description: 'Number of past days to analyze (default 30)', default: 30 }
      },
      required: ['employeeNameOrEmail']
    },
    permissionCheck: (ctx) => ctx.permissions.canViewAllAttendance || ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const { employeeNameOrEmail, timeframeDays = 30 } = args;

      const targetUser = await User.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { email: { $regex: new RegExp(`^${employeeNameOrEmail.trim()}$`, 'i') } },
          { name: { $regex: new RegExp(employeeNameOrEmail.trim(), 'i') } }
        ]
      }).select('_id name email employeeId department');

      if (!targetUser) {
        throw new Error(`Employee matching '${employeeNameOrEmail}' was not found.`);
      }

      const sinceDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);

      // 1. Task metrics
      const tasks = await Task.find({
        companyCode: ctx.companyCode,
        assignedUsers: targetUser._id,
        createdAt: { $gte: sinceDate }
      }).lean();

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'completed');
      const completedCount = completedTasks.length;
      const pendingCount = tasks.filter(t => ['pending', 'in-progress'].includes(t.status)).length;
      const overdueCount = tasks.filter(t => t.status === 'overdue' || (t.status !== 'completed' && t.dueDateTime && new Date(t.dueDateTime) < new Date())).length;
      
      const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 100;

      // 2. Attendance metrics
      const attendanceLogs = await Attendance.find({
        companyCode: ctx.companyCode,
        user: targetUser._id,
        date: { $gte: sinceDate }
      }).lean();

      const presentCount = attendanceLogs.filter(a => String(a.status || '').toUpperCase().includes('PRESENT')).length;
      const lateCount = attendanceLogs.filter(a => String(a.status || '').toUpperCase().includes('LATE')).length;
      const onTimeRate = (presentCount + lateCount) > 0 ? Math.round((presentCount / (presentCount + lateCount)) * 100) : 100;

      // Overall composite efficiency score (out of 100)
      const efficiencyScore = Math.round((completionRate * 0.7) + (onTimeRate * 0.3));

      return {
        employee: {
          id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          department: targetUser.department || 'General'
        },
        timeframeDays,
        overallEfficiencyScore: `${efficiencyScore}%`,
        taskMetrics: {
          totalAssigned: totalTasks,
          completed: completedCount,
          pending: pendingCount,
          overdue: overdueCount,
          completionRate: `${completionRate}%`
        },
        attendanceMetrics: {
          daysLogged: attendanceLogs.length,
          presentOnTime: presentCount,
          latePunches: lateCount,
          punctualityRate: `${onTimeRate}%`
        },
        aiSummary: `${targetUser.name} has completed ${completedCount}/${totalTasks} tasks (${completionRate}%) with an on-time punctuality rate of ${onTimeRate}%. Overall efficiency rating: ${efficiencyScore}%.`
      };
    }
  },

  {
    name: 'get_team_workload',
    description: 'Returns workload overview across team members (who has the most pending tasks, overdue tasks). GATED: Requires HR / Manager / Admin.',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Optional department filter' }
      }
    },
    permissionCheck: (ctx) => ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const userQuery = {
        companyCode: ctx.companyCode,
        isActive: { $ne: false },
        companyRole: { $not: /^client$/i }
      };
      if (args.department) userQuery.department = args.department;

      const users = await User.find(userQuery).select('_id name email department').lean();
      const userIds = users.map(u => u._id);

      const activeTasks = await Task.find({
        companyCode: ctx.companyCode,
        assignedUsers: { $in: userIds },
        status: { $in: ['pending', 'in-progress', 'overdue'] }
      }).select('assignedUsers status dueDateTime').lean();

      const userWorkload = users.map(u => {
        const uIdStr = String(u._id);
        const myTasks = activeTasks.filter(t => (t.assignedUsers || []).some(id => String(id) === uIdStr));
        const overdue = myTasks.filter(t => t.status === 'overdue' || (t.dueDateTime && new Date(t.dueDateTime) < new Date())).length;
        return {
          name: u.name,
          email: u.email,
          activeTasksCount: myTasks.length,
          overdueTasksCount: overdue
        };
      });

      userWorkload.sort((a, b) => b.activeTasksCount - a.activeTasksCount);

      return {
        totalEmployees: users.length,
        workloadRankings: userWorkload
      };
    }
  }
];

module.exports = performanceTools;
