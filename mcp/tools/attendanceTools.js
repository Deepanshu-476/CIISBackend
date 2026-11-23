const Attendance = require('../../HR-CDS/models/Attendance');
const User = require('../../models/User');
const { attendanceExportSummary } = require('../../HR-CDS/utils/attendanceExportHelper');

const attendanceTools = [
  {
    name: 'get_my_attendance',
    description: 'Returns the personal attendance records for the authenticated user for today or current month.',
    parameters: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', enum: ['today', 'this_month', 'last_month'], default: 'today' }
      }
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { timeframe = 'today' } = args;
      const query = { companyCode: ctx.companyCode, user: ctx.user._id };

      const now = new Date();
      if (timeframe === 'today') {
        const start = new Date(now.setHours(0, 0, 0, 0));
        const end = new Date(now.setHours(23, 59, 59, 999));
        query.date = { $gte: start, $lte: end };
      } else if (timeframe === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        query.date = { $gte: start, $lte: end };
      }

      const records = await Attendance.find(query).sort({ date: -1 }).lean();
      return {
        user: ctx.user.name,
        timeframe,
        totalDays: records.length,
        records: records.map(r => ({
          date: r.date ? new Date(r.date).toISOString().slice(0, 10) : '-',
          status: r.status || 'ABSENT',
          inTime: r.inTime || '-',
          outTime: r.outTime || '-',
          hoursWorked: r.hoursWorked || '00:00:00'
        }))
      };
    }
  },

  {
    name: 'get_attendance_summary',
    description: 'Returns company-wide attendance summary metrics (Present, Late, Half-Day, Absent counts). GATED: Requires HR / Admin / Owner permission.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format or "today" / "yesterday"', default: 'today' },
        branch: { type: 'string', description: 'Optional Branch name or ID filter' }
      }
    },
    permissionCheck: (ctx) => ctx.permissions.canViewAllAttendance,
    handler: async (args, ctx) => {
      if (!ctx.permissions.canViewAllAttendance) {
        throw new Error('Permission denied: You do not have permission to view company-wide attendance.');
      }

      const { date = 'today' } = args;
      let targetDate = new Date();
      if (date === 'yesterday') {
        targetDate.setDate(targetDate.getDate() - 1);
      } else if (date !== 'today' && !isNaN(new Date(date).getTime())) {
        targetDate = new Date(date);
      }

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Active employees in company
      const userQuery = {
        companyCode: ctx.companyCode,
        isActive: { $ne: false },
        companyRole: { $not: /^client$/i }
      };
      if (args.branch && args.branch !== 'all') {
        userQuery.branch = args.branch;
      }

      const companyUsers = await User.find(userQuery).select('name email employeeId branch department').lean();
      const existingRecords = await Attendance.find({
        companyCode: ctx.companyCode,
        date: { $gte: startOfDay, $lte: endOfDay }
      }).populate('user', 'name email').lean();

      const attendanceMap = {};
      existingRecords.forEach(r => {
        const uId = String(r.user?._id || r.user?.id || r.user || '');
        if (uId) attendanceMap[uId] = r;
      });

      let presentCount = 0;
      let lateCount = 0;
      let halfDayCount = 0;
      let absentCount = 0;

      const employeeStatusList = companyUsers.map(u => {
        const uId = String(u._id || u.id);
        const record = attendanceMap[uId];
        let status = 'ABSENT';
        if (record) {
          status = String(record.status || '').toUpperCase();
          if (status.includes('PRESENT')) presentCount++;
          else if (status.includes('LATE')) lateCount++;
          else if (status.includes('HALF')) halfDayCount++;
          else absentCount++;
        } else {
          absentCount++;
        }
        return {
          name: u.name,
          employeeId: u.employeeId || '-',
          status,
          inTime: record?.inTime || '-',
          outTime: record?.outTime || '-'
        };
      });

      return {
        date: startOfDay.toISOString().slice(0, 10),
        totalEmployees: companyUsers.length,
        summary: {
          total: companyUsers.length,
          present: presentCount,
          late: lateCount,
          halfDay: halfDayCount,
          absent: absentCount
        },
        employees: employeeStatusList
      };
    }
  },

  {
    name: 'get_employee_attendance',
    description: 'Returns attendance log of a specific employee for a given month. GATED: Requires HR / Admin / Owner permission.',
    parameters: {
      type: 'object',
      properties: {
        employeeNameOrEmail: { type: 'string', description: 'Name or email of the employee' },
        month: { type: 'number', description: 'Month (1-12)', default: new Date().getMonth() + 1 },
        year: { type: 'number', description: 'Year (e.g. 2026)', default: new Date().getFullYear() }
      },
      required: ['employeeNameOrEmail']
    },
    permissionCheck: (ctx) => ctx.permissions.canViewAllAttendance,
    handler: async (args, ctx) => {
      if (!ctx.permissions.canViewAllAttendance) {
        throw new Error('Permission denied: You do not have permission to view other employees attendance.');
      }

      const { employeeNameOrEmail, month = new Date().getMonth() + 1, year = new Date().getFullYear() } = args;

      const targetUser = await User.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { email: { $regex: new RegExp(`^${employeeNameOrEmail.trim()}$`, 'i') } },
          { name: { $regex: new RegExp(employeeNameOrEmail.trim(), 'i') } }
        ]
      }).select('_id name email employeeId department');

      if (!targetUser) {
        throw new Error(`Employee '${employeeNameOrEmail}' was not found in company ${ctx.companyCode}.`);
      }

      const start = new Date(year, month - 1, 1, 0, 0, 0);
      const end = new Date(year, month, 0, 23, 59, 59);

      const records = await Attendance.find({
        companyCode: ctx.companyCode,
        user: targetUser._id,
        date: { $gte: start, $lte: end }
      }).sort({ date: 1 }).lean();

      return {
        employee: targetUser.name,
        email: targetUser.email,
        month,
        year,
        totalPunchedDays: records.length,
        records: records.map(r => ({
          date: r.date ? new Date(r.date).toISOString().slice(0, 10) : '-',
          status: r.status,
          inTime: r.inTime || '-',
          outTime: r.outTime || '-',
          hoursWorked: r.hoursWorked || '00:00:00'
        }))
      };
    }
  }
];

module.exports = attendanceTools;
