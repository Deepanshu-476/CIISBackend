const mongoose = require("mongoose");
const EmployeeSalary = require("../models/EmployeeSalary");
const SalaryStructure = require("../models/SalaryStructure");
const SalaryComponent = require("../models/SalaryComponent");
const User = require("../models/User");
const Department = require("../models/Department");
const JobRole = require("../models/JobRole");
const Attendance = require("../HR-CDS/models/Attendance");
const Leave = require("../HR-CDS/models/Leave");
const Holiday = require("../HR-CDS/models/Holiday");
const PayrollRun = require("../models/PayrollRun");
const Company = require("../models/Company");
const { validateBulkEmployeeStatuses, applyBulkEmployeeTransition, deriveRunStatus } = require("../utils/payrollFlow");
const { sendEmail } = require("../utils/sendEmail");

const getCompany = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;
const getActorName = (req) => req.user?.name || req.user?.fullName || req.user?.email || "Payroll User";

const populateQuery = (query) =>
  query
    .populate("user", "name email department jobRole employeeId empId phone profileImage status dateOfJoining bankName accountNumber ifsc bankHolderName panCard panNo pan aadharCard aadharNo aadhar aadhaar aadhaarCard dob")
    .populate("salaryStructure", "name code salaryType salaryInputType effectiveFrom status description components")
    .populate("components.component", "name code type proRata taxable grossSalary pfWage esiWage ptWage")
    .populate("createdBy", "name email")
    .populate("updatedBy", "name email");

const setCompVal = (map, row, amt) => {
  const comp = (typeof row.component === "object" && row.component !== null) ? row.component : {};
  const code = String(comp.code || row.code || "").trim().toUpperCase();
  const name = String(comp.name || row.name || "").trim().toUpperCase();
  const id = String(comp._id || row._id || "");
  if (code) map.set(code, amt);
  if (name) map.set(name, amt);
  if (id) map.set(id, amt);
  if (name.includes("BASIC") || code === "BS" || code === "BASIC") {
    map.set("BASIC", amt);
    map.set("BASIC SALARY", amt);
    map.set("BS", amt);
  }
};

const getCompVal = (map, baseStr, defaultVal = 0) => {
  const key = String(baseStr || "").trim().toUpperCase();
  if (map.has(key)) return map.get(key);
  if (key.includes("BASIC")) {
    if (map.has("BASIC")) return map.get("BASIC");
    if (map.has("BASIC SALARY")) return map.get("BASIC SALARY");
    if (map.has("BS")) return map.get("BS");
  }
  return defaultVal;
};

// Helper to compute breakdown from structure & baseAmount
const computeBreakdown = (structure, baseAmount, salaryType = "monthly", salaryInputType = "gross", overrides = []) => {
  const isAnnual = salaryType === "annual";
  const monthlyBase = isAnnual ? Number(baseAmount) / 12 : Number(baseAmount);
  const overrideMap = new Map();
  const lockedMap = new Map();

  (Array.isArray(overrides) ? overrides : []).forEach(ov => {
    const id = String(ov.component?._id || ov.component || "");
    if (id) {
      if (ov.amount !== undefined && ov.amount !== null && !Number.isNaN(Number(ov.amount))) {
        overrideMap.set(id, Number(ov.amount));
      }
      if (ov.isLocked !== undefined) {
        lockedMap.set(id, Boolean(ov.isLocked));
      }
    }
  });

  const components = [];
  const compCodeMap = new Map(); // CODE -> monthlyAmount
  let totalEarnings = 0;
  let totalDeductions = 0;
  let pfWageBase = 0;
  let esiWageBase = 0;

  const sorted = [...(structure.components || [])].sort((a, b) => (a.sortOrder || 1) - (b.sortOrder || 1));

  for (const row of sorted) {
    const comp = row.component;
    const compId = String(comp?._id || comp || "");
    const compName = comp?.name || row.name || "Component";
    const compCode = (comp?.code || row.code || "").toUpperCase();
    const compType = comp?.type || row.type || "earning";
    const calcType = (row.calculationType || "manual").toLowerCase();
    const calcBase = String(row.calculationBase || "").trim();
    const formulaStr = String(row.formula || "").trim();
    const rateVal = Number(row.value || 0);

    let monthlyAmount = 0;

    if (overrideMap.has(compId)) {
      monthlyAmount = Math.max(0, overrideMap.get(compId));
    } else if (calcType === "manual") {
      monthlyAmount = Math.max(0, rateVal);
    } else if (calcType === "percentage") {
      const baseUpper = calcBase.toUpperCase();
      let baseVal = monthlyBase;

      if (baseUpper.includes("BASIC")) {
        baseVal = getCompVal(compCodeMap, "BASIC", 0);
      } else if (baseUpper.includes("PF")) {
        baseVal = pfWageBase || getCompVal(compCodeMap, "BASIC", monthlyBase);
      } else if (baseUpper.includes("ESI")) {
        baseVal = esiWageBase || monthlyBase;
      } else if (compCodeMap.has(baseUpper)) {
        baseVal = compCodeMap.get(baseUpper) || 0;
      } else if (baseUpper.includes("GROSS") || baseUpper.includes("CTC") || !calcBase) {
        baseVal = monthlyBase;
      } else {
        baseVal = getCompVal(compCodeMap, calcBase, monthlyBase);
      }

      monthlyAmount = (baseVal * rateVal) / 100;
    } else if (calcType === "formula") {
      let expr = formulaStr.toUpperCase();
      if (!expr && (compCode === "SPL" || compCode === "SPECIAL")) {
        // Default special allowance = Gross - sum of other earnings
        let otherEarnings = 0;
        compCodeMap.forEach((v, k) => {
          if (k !== compCode) otherEarnings += v;
        });
        monthlyAmount = Math.max(0, monthlyBase - otherEarnings);
      } else {
        const replacements = [
          { key: "GROSS SALARY", val: monthlyBase },
          { key: "GROSS", val: monthlyBase },
          { key: "CTC", val: monthlyBase }
        ];

        sorted.forEach((otherRow) => {
          const oc = otherRow.component || {};
          const oCode = (oc.code || otherRow.code || "").toUpperCase();
          const oName = (oc.name || otherRow.name || "").toUpperCase();
          const val = getCompVal(compCodeMap, oCode) || getCompVal(compCodeMap, oName) || 0;
          if (oName) replacements.push({ key: oName, val });
          if (oCode) replacements.push({ key: oCode, val });
        });

        replacements.sort((a, b) => b.key.length - a.key.length);
        replacements.forEach(({ key, val }) => {
          if (key) {
            const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            expr = expr.replace(new RegExp(`\\b${esc}\\b`, "gi"), String(val));
          }
        });

        expr = expr.replace(/₹|RS\.?/gi, "").trim();

        if (/^[0-9+\-*/().\s]+$/.test(expr)) {
          try {
            // eslint-disable-next-line no-eval
            const evaluated = Function(`"use strict"; return (${expr})`)();
            monthlyAmount = Number.isFinite(evaluated) && evaluated >= 0 ? evaluated : 0;
          } catch {
            monthlyAmount = 0;
          }
        }
      }
    }

    monthlyAmount = Math.round(monthlyAmount * 100) / 100;
    setCompVal(compCodeMap, row, monthlyAmount);

    if (comp?.pfWage || compCode === "BASIC" || compCode === "DA") {
      pfWageBase += monthlyAmount;
    }
    if (comp?.esiWage || compType === "earning") {
      esiWageBase += monthlyAmount;
    }

    if (compType === "earning") {
      totalEarnings += monthlyAmount;
    } else {
      totalDeductions += monthlyAmount;
    }

    components.push({
      component: compId,
      name: compName,
      code: compCode,
      type: compType,
      calculationType: calcType,
      calculationBase: calcBase,
      formula: formulaStr,
      value: rateVal,
      amount: monthlyAmount,
      annualAmount: Math.round(monthlyAmount * 12 * 100) / 100,
      isOverride: overrideMap.has(compId),
      isLocked: lockedMap.has(compId) ? lockedMap.get(compId) : true,
      sortOrder: row.sortOrder || 1
    });
  }

  // Gross-based salaries must reconcile to the entered gross amount. Prefer an
  // explicitly configured balance row; older structures fall back to their
  // last earning component so existing assignments also calculate correctly.
  if (salaryInputType === "gross") {
    const balanceIndex = components.findIndex(item => item.type === "earning" && item.calculationType === "balance");
    const specialIndex = components.findIndex(item => item.type === "earning" && (String(item.code).toUpperCase() === "SPL" || String(item.code).toUpperCase() === "SPECIAL" || String(item.name).toUpperCase().includes("SPECIAL")));
    const fallbackIndex = components.reduce((found, item, index) => item.type === "earning" ? index : found, -1);
    const targetIndex = balanceIndex >= 0 ? balanceIndex : (specialIndex >= 0 ? specialIndex : fallbackIndex);

    const otherEarningsSum = components.reduce((sum, item, index) => sum + (item.type === "earning" && index !== targetIndex ? Number(item.amount || 0) : 0), 0);
    const difference = Math.round((monthlyBase - otherEarningsSum) * 100) / 100;

    if (targetIndex >= 0) {
      const target = components[targetIndex];
      target.amount = Math.max(0, difference);
      target.annualAmount = Math.round(target.amount * 12 * 100) / 100;
      target.calculationBase = "Gross Salary";
      target.formula = "Gross - Other Earnings";
      target.isAutoBalanced = true;
      totalEarnings = monthlyBase;
    }
  }

  const monthlyGross = Math.round(totalEarnings * 100) / 100;
  const monthlyNet = Math.round(Math.max(0, totalEarnings - totalDeductions) * 100) / 100;
  const monthlyCTC = monthlyGross;
  const annualCTC = Math.round(monthlyCTC * 12 * 100) / 100;

  return {
    components,
    monthlyGross,
    monthlyNet,
    monthlyCTC,
    annualCTC,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100
  };
};

const indiaDateKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

const effectiveWorkingDays = (department, date) => {
  let days = Number(department?.workingDays || 5);
  const target = new Date(date).getTime();
  const history = [...(department?.workingDayHistory || [])]
    .filter(item => item?.effectiveFrom)
    .sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom));
  history.forEach(item => {
    if (new Date(item.effectiveFrom).getTime() <= target) days = Number(item.workingDays || days);
  });
  return Number.isInteger(days) && days >= 1 && days <= 7 ? days : 5;
};

const attendanceRecordScore = (record = {}) => {
  const status = String(record.status || "").trim().toUpperCase();
  let score = 0;
  if (record.inTime) score += 1000;
  if (record.outTime) score += 1000;
  if (record.inTime && record.outTime) score += 500;
  if (!["ABSENT", "WEEKEND"].includes(status)) score += 100;
  if (record.clockOutMode) score += 20;
  if (String(record.totalTime || "00:00:00") !== "00:00:00") score += 10;
  return score;
};

const buildAttendanceMap = (records = []) => {
  const map = new Map();
  records.forEach(record => {
    const key = `${record.user}:${indiaDateKey(record.date)}`;
    const current = map.get(key);
    if (!current || attendanceRecordScore(record) > attendanceRecordScore(current)) {
      map.set(key, record);
    }
  });
  return map;
};

// GET /api/employee-salaries/payroll-preview?month=YYYY-MM
exports.payrollPreview = async (req, res) => {
  try {
    const company = getCompany(req);
    const companyCode = req.user?.companyCode || req.user?.company?.companyCode;
    const month = String(req.query?.month || req.body?.month || "").trim();
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (!company || !match) {
      return res.status(400).json({ success: false, message: "A valid payroll month is required." });
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const start = new Date(Date.UTC(year, monthIndex, 1) - (330 * 60 * 1000));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1) - (330 * 60 * 1000) - 1);
    const assignments = await populateQuery(EmployeeSalary.find({ company, status: "active" }))
      .populate("components.component", "name code type proRata")
      .lean();
    const userIds = assignments.map(item => item.user?._id || item.user).filter(Boolean);
    const departmentIds = [...new Set(assignments.map(item => item.user?.department).filter(id => mongoose.isValidObjectId(id)).map(String))];

    const [attendances, leaves, holidays, departments] = await Promise.all([
      Attendance.find({ user: { $in: userIds }, date: { $gte: start, $lte: end } }).lean(),
      Leave.find({ user: { $in: userIds }, status: "Approved", startDate: { $lte: end }, endDate: { $gte: start } }).lean(),
      Holiday.find({ company, isActive: { $ne: false }, date: { $gte: start, $lte: end } }).lean(),
      Department.find({ _id: { $in: departmentIds } }).select("name workingDays workingDayHistory").lean()
    ]);

    const departmentMap = new Map(departments.map(item => [String(item._id), item]));
    const holidayKeys = new Set(holidays.map(item => indiaDateKey(item.date)));
    // Attendance calendar also collapses duplicate placeholder ABSENT rows and
    // real clock-in rows for the same India date. Payroll must use the same
    // winner rule so an auto-absent record never hides actual attendance.
    const attendanceMap = buildAttendanceMap(attendances);
    const leaveByUser = new Map();
    leaves.forEach(item => {
      const key = String(item.user);
      if (!leaveByUser.has(key)) leaveByUser.set(key, []);
      leaveByUser.get(key).push(item);
    });

    const calendarDates = [];
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const todayKey = indiaDateKey(new Date());
    for (let day = 1; day <= daysInMonth; day += 1) {
      calendarDates.push(new Date(Date.UTC(year, monthIndex, day, 6)));
    }

    const runDoc = await PayrollRun.findOne({ company, month }).lean();
    const salaryDaysBasis = String(req.query?.salaryDaysBasis || req.body?.salaryDaysBasis || runDoc?.salaryDaysBasis || "calendar").toLowerCase();
    const sandwichRuleEnabled = (req.query?.sandwichRuleEnabled !== undefined || req.body?.sandwichRuleEnabled !== undefined)
      ? String(req.query?.sandwichRuleEnabled || req.body?.sandwichRuleEnabled || "false") === "true"
      : Boolean(runDoc?.sandwichRuleEnabled);

    let daysBasisCount = daysInMonth;
    if (salaryDaysBasis === "fixed30") daysBasisCount = 30;
    else if (salaryDaysBasis === "fixed26") daysBasisCount = 26;

    const elapsedCalendarDays = calendarDates.filter(date => indiaDateKey(date) <= todayKey).length;

    const employees = assignments.map(assignment => {
      const userId = String(assignment.user?._id || assignment.user);
      const departmentDoc = departmentMap.get(String(assignment.user?.department || ""));
      const joiningKey = assignment.dateOfJoining || assignment.user?.dateOfJoining
        ? indiaDateKey(assignment.dateOfJoining || assignment.user.dateOfJoining)
        : "";
      let workingDays = 0;
      let eligibleWorkingDays = 0;
      let presentDays = 0;
      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      let uninformedLeaveDays = 0;
      let halfDayDays = 0;
      let lopDays = 0;
      let actualAbsentDays = 0;
      let sandwichLopDays = 0;
      let pendingDays = 0;
      let futureDays = 0;
      let elapsedWeekOffDays = 0;
      let elapsedHolidays = 0;

      calendarDates.forEach((date, idx) => {
        const key = indiaDateKey(date);
        const dayOfWeek = date.getUTCDay() || 7;
        const attendance = attendanceMap.get(`${userId}:${key}`);
        const status = String(attendance?.status || "").trim().toUpperCase();
        const isHoliday = holidayKeys.has(key) || status === "HOLIDAY";
        const isWeekOff = dayOfWeek > effectiveWorkingDays(departmentDoc, date);
        const isOffDay = isWeekOff || isHoliday;

        if (isOffDay) {
          if ((!joiningKey || key >= joiningKey) && key <= todayKey) {
            if (isHoliday) elapsedHolidays += 1;
            else if (isWeekOff) elapsedWeekOffDays += 1;
          }

          // Check Sandwich LOP if policy enabled
          if (sandwichRuleEnabled && (!joiningKey || key >= joiningKey) && key <= todayKey) {
            let prevStatus = "";
            for (let i = idx - 1; i >= 0; i--) {
              const pDate = calendarDates[i];
              const pKey = indiaDateKey(pDate);
              const pDayOfWeek = pDate.getUTCDay() || 7;
              if (pDayOfWeek <= effectiveWorkingDays(departmentDoc, pDate) && !holidayKeys.has(pKey)) {
                const pLeave = (leaveByUser.get(userId) || []).find(item => (pKey >= indiaDateKey(item.startDate) && pKey <= indiaDateKey(item.endDate)));
                if (pLeave) {
                  prevStatus = String(pLeave.payType).toLowerCase() === "unpaid" ? "ABSENT" : "PRESENT";
                } else {
                  const pAtt = attendanceMap.get(`${userId}:${pKey}`);
                  prevStatus = String(pAtt?.status || "").trim().toUpperCase();
                }
                break;
              }
            }

            let nextStatus = "";
            for (let i = idx + 1; i < calendarDates.length; i++) {
              const nDate = calendarDates[i];
              const nKey = indiaDateKey(nDate);
              const nDayOfWeek = nDate.getUTCDay() || 7;
              if (nDayOfWeek <= effectiveWorkingDays(departmentDoc, nDate) && !holidayKeys.has(nKey)) {
                const nLeave = (leaveByUser.get(userId) || []).find(item => (nKey >= indiaDateKey(item.startDate) && nKey <= indiaDateKey(item.endDate)));
                if (nLeave) {
                  nextStatus = String(nLeave.payType).toLowerCase() === "unpaid" ? "ABSENT" : "PRESENT";
                } else {
                  const nAtt = attendanceMap.get(`${userId}:${nKey}`);
                  nextStatus = String(nAtt?.status || "").trim().toUpperCase();
                }
                break;
              }
            }

            if (["ABSENT", "UNPAID"].includes(prevStatus) && ["ABSENT", "UNPAID"].includes(nextStatus)) {
              sandwichLopDays += 1;
            }
          }
          return;
        }

        workingDays += 1;
        if (joiningKey && key < joiningKey) return;
        if (key > todayKey) {
          futureDays += 1;
          return;
        }
        eligibleWorkingDays += 1;

        const approvedLeave = (leaveByUser.get(userId) || []).find(item => (
          key >= indiaDateKey(item.startDate) && key <= indiaDateKey(item.endDate)
        ));
        if (approvedLeave) {
          if (String(approvedLeave.payType).toLowerCase() === "unpaid") {
            unpaidLeaveDays += 1;
            lopDays += 1;
          } else {
            paidLeaveDays += 1;
          }
          return;
        }

        if (["PRESENT", "LATE", "SHORT LEAVE"].includes(status)) presentDays += 1;
        else if (["HALF DAY", "HALFDAY"].includes(status)) {
          presentDays += 0.5;
          halfDayDays += 1;
        } else if (["UNINFORMED LEAVE", "UNINFORMEDLEAVE"].includes(status)) {
          lopDays += 1;
          uninformedLeaveDays += 1;
        } else if (status === "ABSENT") {
          lopDays += 1;
          actualAbsentDays += 1;
        }
        else pendingDays += 1;
      });

      const uninformedLeavePenaltyDays = uninformedLeaveDays;
      const totalLopDays = lopDays + sandwichLopDays;
      const deductionDays = totalLopDays + uninformedLeavePenaltyDays + (halfDayDays * 0.5);
      const payableDays = Math.max(0, presentDays + paidLeaveDays);
      const projectedPayableDays = Math.max(0, eligibleWorkingDays - deductionDays);

      const divisorDays = salaryDaysBasis === "fixed30" ? 30 : salaryDaysBasis === "fixed26" ? 26 : daysInMonth;
      const effectivePayableDays = Math.max(0, divisorDays - deductionDays);
      const ratio = divisorDays > 0 ? Math.min(1, effectivePayableDays / divisorDays) : 0;
      const projectedRatio = ratio;

      const adjustedComponents = (assignment.components || []).map(item => {
        const shouldProrate = item.type === "earning" && item.component?.proRata !== false;
        const amount = shouldProrate ? Number(item.amount || 0) * ratio : Number(item.amount || 0);
        const projectedAmount = shouldProrate ? Number(item.amount || 0) * projectedRatio : Number(item.amount || 0);
        return { ...item, payrollAmount: Math.round(amount * 100) / 100, projectedPayrollAmount: Math.round(projectedAmount * 100) / 100 };
      });

      const gross = adjustedComponents.reduce((sum, item) => sum + (item.type === "earning" ? item.payrollAmount : 0), 0);
      const projectedGross = adjustedComponents.reduce((sum, item) => sum + (item.type === "earning" ? item.projectedPayrollAmount : 0), 0);
      const deductions = adjustedComponents.reduce((sum, item) => sum + (item.type === "deduction" ? item.payrollAmount : 0), 0);
      const assignedGross = Number(assignment.monthlyGross || 0);
      const attendanceDeduction = divisorDays > 0
        ? Math.round((assignedGross * deductionDays / divisorDays) * 100) / 100
        : 0;
      const lopDeduction = deductionDays > 0
        ? Math.round((attendanceDeduction * totalLopDays / deductionDays) * 100) / 100
        : 0;
      const uninformedLeavePenaltyDeduction = deductionDays > 0
        ? Math.round((attendanceDeduction * uninformedLeavePenaltyDays / deductionDays) * 100) / 100
        : 0;
      const halfDayDeduction = Math.round(Math.max(0, attendanceDeduction - lopDeduction - uninformedLeavePenaltyDeduction) * 100) / 100;
      const pendingAmount = Math.round(Math.max(0, projectedGross - gross) * 100) / 100;
      const earnedBeforeAttendance = assignedGross;
      const totalAppliedDeductions = Math.round((deductions + attendanceDeduction) * 100) / 100;

      const weekOffDays = Math.max(0, daysInMonth - workingDays);
      const isMonthCompleted = futureDays === 0 && pendingDays === 0;
      const tillDatePayableDays = Math.max(0, elapsedCalendarDays - deductionDays);
      const tillDateRatio = divisorDays > 0 ? Math.min(1, tillDatePayableDays / divisorDays) : 0;
      const earnedTillDateGross = !isMonthCompleted ? Math.round(assignedGross * tillDateRatio * 100) / 100 : earnedBeforeAttendance;
      const earnedTillDateNet = !isMonthCompleted ? Math.round(Math.max(0, earnedTillDateGross - deductions) * 100) / 100 : Math.round(Math.max(0, earnedBeforeAttendance - totalAppliedDeductions) * 100) / 100;


      return {
        ...assignment,
        attendance: {
          workingDays,
          eligibleWorkingDays,
          presentDays,
          paidLeaveDays,
          unpaidLeaveDays,
          uninformedLeaveDays,
          uninformedLeavePenaltyDays,
          holidayDays: elapsedHolidays,
          halfDayDays,
          actualAbsentDays,
          lopDays,
          sandwichLopDays,
          totalLopDays,
          deductionDays,
          pendingDays,
          futureDays,
          payableDays,
          daysInMonth,
          weekOffDays,
          daysBasisCount: divisorDays,
          calculationCutoff: todayKey
        },
        assignedGross,
        attendanceDeduction,
        lopDeduction,
        uninformedLeavePenaltyDeduction,
        halfDayDeduction,
        pendingAmount,
        earnedTillDateGross,
        earnedTillDateNet,
        monthlyGross: assignedGross,
        payableGross: Math.round(Math.max(0, assignedGross - attendanceDeduction) * 100) / 100,
        salaryDeductions: Math.round(deductions * 100) / 100,
        totalDeductions: totalAppliedDeductions,
        monthlyNet: Math.round(Math.max(0, assignedGross - totalAppliedDeductions) * 100) / 100,
        components: adjustedComponents,
        payrollStatus: "Calculated"
      };
    });

    return res.json({ success: true, month, salaryDaysBasis, sandwichRuleEnabled, employees });
  } catch (error) {
    console.error("Payroll preview error:", error);
    return res.status(500).json({ success: false, message: "Unable to calculate attendance-based payroll." });
  }
};

const calculatePayroll = async (req) => {
  let responseStatus = 200;
  let responseBody;
  const response = {
    status(code) { responseStatus = code; return this; },
    json(body) { responseBody = body; return body; }
  };
  await exports.payrollPreview(req, response);
  if (responseStatus >= 400 || !responseBody?.success) {
    const error = new Error(responseBody?.message || "Unable to calculate payroll.");
    error.status = responseStatus;
    throw error;
  }
  return responseBody;
};

const employeePayrollKey = (employee = {}) => String(employee.user?._id || employee.user || employee._id || "");

const withPayrollAdjustments = (employee = {}, adjustments = employee.adjustments || []) => {
  const safeAdjustments = (Array.isArray(adjustments) ? adjustments : []).map(item => ({ ...item, amount: Math.max(0, Number(item.amount || 0)) }));
  const adjustmentDeductions = Math.round(safeAdjustments.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100;
  const componentDeductions = Number(employee.totalDeductions || 0);
  const earnedTillDateGross = Number(employee.earnedTillDateGross ?? employee.monthlyGross ?? 0);
  return {
    ...employee,
    adjustments: safeAdjustments,
    adjustmentDeductions,
    monthlyNet: Math.round(Math.max(0, Number(employee.monthlyGross || 0) - componentDeductions - adjustmentDeductions) * 100) / 100,
    earnedTillDateGross,
    earnedTillDateNet: Math.round(Math.max(0, earnedTillDateGross - componentDeductions - adjustmentDeductions) * 100) / 100
  };
};

const payrollTotals = (employees = []) => employees.reduce((totals, employee) => {
  const gross = Number(employee.monthlyGross || 0);
  const rawDeductions = Number(employee.totalDeductions || 0) + Number(employee.adjustmentDeductions || 0);
  const net = Number(employee.monthlyNet || 0);
  const effectiveDeduction = Math.min(gross, rawDeductions);

  return {
    employees: totals.employees + 1,
    earnings: Math.round((totals.earnings + gross) * 100) / 100,
    deductions: Math.round((totals.deductions + effectiveDeduction) * 100) / 100,
    net: Math.round((totals.net + net) * 100) / 100,
    pendingAttendance: totals.pendingAttendance + Number(employee.attendance?.pendingDays || 0)
  };
}, { employees: 0, earnings: 0, deductions: 0, net: 0, pendingAttendance: 0 });

const payrollRunJson = (run) => ({
  _id: run._id,
  month: run.month,
  status: run.status,
  salaryDaysBasis: run.salaryDaysBasis || "calendar",
  sandwichRuleEnabled: Boolean(run.sandwichRuleEnabled),
  employees: run.employees || [],
  totals: run.totals,
  calculatedAt: run.calculatedAt,
  reviewedAt: run.reviewedAt,
  approvedAt: run.approvedAt,
  lockedAt: run.lockedAt,
  auditLog: run.auditLog || [],
  saved: true
});

// Older payroll snapshots can outlive a deleted salary-structure master. When the
// source assignment has since been repaired, use its current structure only to
// fill the missing display metadata. The saved payroll amounts and statuses stay
// untouched.
const fillMissingSalaryStructures = async (company, run) => {
  const employees = Array.isArray(run.employees) ? run.employees : [];
  const missingUserIds = employees
    .filter(employee => !employee.salaryStructure?.name)
    .map(employee => employeePayrollKey(employee))
    .filter(mongoose.isValidObjectId);
  if (!missingUserIds.length) return run;

  const assignments = await EmployeeSalary.find({
    company,
    user: { $in: missingUserIds },
    status: "active"
  })
    .populate("salaryStructure", "name code")
    .select("user salaryStructure")
    .lean();
  const structureByUser = new Map(assignments
    .filter(assignment => assignment.salaryStructure?.name)
    .map(assignment => [String(assignment.user), assignment.salaryStructure]));

  return {
    ...run,
    employees: employees.map(employee => employee.salaryStructure?.name
      ? employee
      : { ...employee, salaryStructure: structureByUser.get(employeePayrollKey(employee)) || employee.salaryStructure })
  };
};

const paginatePayrollRun = (req, run) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const department = String(req.query.department || "").trim();
  const allEmployees = Array.isArray(run.employees) ? run.employees : [];
  const departments = [...new Set(allEmployees.map(employee => String(employee.department || employee.user?.department?.name || "").trim()).filter(Boolean))].sort();
  const filteredEmployees = department
    ? allEmployees.filter(employee => String(employee.department || employee.user?.department?.name || "").trim() === department)
    : allEmployees;
  const total = filteredEmployees.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    ...run,
    employees: filteredEmployees.slice(start, start + limit),
    filteredTotals: payrollTotals(filteredEmployees),
    pagination: { page: safePage, limit, total, totalPages },
    filterOptions: { departments }
  };
};

// GET /api/employee-salaries/payroll-run?month=YYYY-MM
exports.getPayrollRun = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.query.month || "").trim();
    if (!company || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "A valid payroll month is required." });
    }
    const run = await PayrollRun.findOne({ company, month }).lean();
    if (run) {
      const displayRun = await fillMissingSalaryStructures(company, payrollRunJson(run));
      return res.json({ success: true, run: paginatePayrollRun(req, displayRun) });
    }

    const preview = await calculatePayroll(req);
    return res.json({
      success: true,
      run: paginatePayrollRun(req, { month, status: "Draft", salaryDaysBasis: preview.salaryDaysBasis || "calendar", sandwichRuleEnabled: Boolean(preview.sandwichRuleEnabled), employees: preview.employees, totals: payrollTotals(preview.employees), saved: false })
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to load payroll run." });
  }
};

// POST /api/employee-salaries/payroll-run/generate
exports.generatePayrollRun = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || req.query?.month || "").trim();
    if (!company || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "A valid payroll month is required." });
    }
    const existing = await PayrollRun.findOne({ company, month });
    if (existing && ["Approved", "Locked"].includes(existing.status)) {
      return res.status(409).json({ success: false, message: `${existing.status} payroll must be reopened before recalculation.` });
    }

    if (req.body?.salaryDaysBasis) req.query.salaryDaysBasis = req.body.salaryDaysBasis;
    if (req.body?.sandwichRuleEnabled !== undefined) req.query.sandwichRuleEnabled = String(req.body.sandwichRuleEnabled);

    const calculation = await calculatePayroll(req);
    const actor = req.user?._id || req.user?.id;
    const previousStatus = existing?.status || "Draft";
    const run = existing || new PayrollRun({ company, month, createdBy: actor });
    
    if (req.body?.salaryDaysBasis) run.salaryDaysBasis = req.body.salaryDaysBasis;
    if (req.body?.sandwichRuleEnabled !== undefined) run.sandwichRuleEnabled = Boolean(req.body.sandwichRuleEnabled);

    const existingAdjustments = new Map((existing?.employees || []).map(employee => [employeePayrollKey(employee), employee.adjustments || []]));
    const calculatedEmployees = calculation.employees.map(employee => withPayrollAdjustments(employee, existingAdjustments.get(employeePayrollKey(employee)) || []));
    run.employees = calculatedEmployees;
    run.totals = payrollTotals(calculatedEmployees);
    run.status = "Calculated";
    run.calculatedAt = new Date();
    run.updatedBy = actor;
    run.auditLog.push({ action: existing ? "Recalculate Payroll" : "Generate Payroll", fromStatus: previousStatus, toStatus: "Calculated", performedBy: actor, performedByName: getActorName(req) });
    await run.save();
    return res.json({ success: true, message: "Payroll calculated and saved successfully.", run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to generate payroll." });
  }
};

// PATCH /api/employee-salaries/payroll-run/settings
exports.updatePayrollSettings = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || "").trim();
    const salaryDaysBasis = req.body?.salaryDaysBasis || "calendar";
    const sandwichRuleEnabled = Boolean(req.body?.sandwichRuleEnabled);

    if (!company || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "A valid payroll month is required." });
    }

    let run = await PayrollRun.findOne({ company, month });
    if (run && ["Approved", "Locked"].includes(run.status)) {
      return res.status(409).json({ success: false, message: `${run.status} payroll must be reopened before updating settings.` });
    }

    req.query.salaryDaysBasis = salaryDaysBasis;
    req.query.sandwichRuleEnabled = String(sandwichRuleEnabled);

    const calculation = await calculatePayroll(req);
    const actor = req.user?._id || req.user?.id;
    const previousStatus = run?.status || "Draft";

    if (!run) {
      run = new PayrollRun({ company, month, createdBy: actor });
    }

    run.salaryDaysBasis = salaryDaysBasis;
    run.sandwichRuleEnabled = sandwichRuleEnabled;
    const existingAdjustments = new Map((run.employees || []).map(emp => [employeePayrollKey(emp), emp.adjustments || []]));
    const calculatedEmployees = calculation.employees.map(emp => withPayrollAdjustments(emp, existingAdjustments.get(employeePayrollKey(emp)) || []));
    run.employees = calculatedEmployees;
    run.totals = payrollTotals(calculatedEmployees);
    run.status = "Calculated";
    run.calculatedAt = new Date();
    run.updatedBy = actor;
    run.auditLog.push({
      action: "Update Payroll Policy Settings",
      fromStatus: previousStatus,
      toStatus: "Calculated",
      reason: `Days Basis: ${salaryDaysBasis}, Sandwich Rule: ${sandwichRuleEnabled ? "ON" : "OFF"}`,
      performedBy: actor,
      performedByName: getActorName(req)
    });

    await run.save();
    return res.json({
      success: true,
      message: "Payroll policy settings updated and payroll recalculated successfully.",
      run: payrollRunJson(run.toObject())
    });
  } catch (error) {
    console.error("Update payroll settings error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to update payroll settings." });
  }
};

// POST /api/employee-salaries/payroll-run/recalculate-employee
exports.recalculateSingleEmployee = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || req.query?.month || "").trim();
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!company || !/^\d{4}-\d{2}$/.test(month) || !employeeId) {
      return res.status(400).json({ success: false, message: "Valid month and employeeId are required." });
    }
    const run = await PayrollRun.findOne({ company, month });
    if (run && ["Approved", "Locked"].includes(run.status)) {
      return res.status(409).json({ success: false, message: `${run.status} payroll must be reopened before recalculation.` });
    }

    const calculation = await calculatePayroll(req);
    const freshEmployee = calculation.employees.find(emp => employeePayrollKey(emp) === employeeId || String(emp._id || "") === employeeId);
    
    if (!freshEmployee) {
      return res.status(404).json({ success: false, message: "Employee calculation data not found." });
    }

    const actor = req.user?._id || req.user?.id;
    if (!run) {
      const newRun = new PayrollRun({ company, month, createdBy: actor });
      newRun.employees = calculation.employees;
      newRun.totals = payrollTotals(calculation.employees);
      newRun.status = "Calculated";
      newRun.calculatedAt = new Date();
      await newRun.save();
      return res.json({ success: true, message: `Payroll calculated for ${freshEmployee.user?.name || "employee"}.`, run: payrollRunJson(newRun.toObject()) });
    }

    const index = run.employees.findIndex(emp => employeePayrollKey(emp) === employeeId || String(emp._id || "") === employeeId);
    const existingAdjustments = index >= 0 ? (run.employees[index].adjustments || []) : [];
    const updatedEmployee = withPayrollAdjustments(freshEmployee, existingAdjustments);

    if (index >= 0) {
      run.employees[index] = updatedEmployee;
    } else {
      run.employees.push(updatedEmployee);
    }

    run.totals = payrollTotals(run.employees);
    run.updatedBy = actor;
    run.auditLog.push({
      action: "Recalculate Single Employee Payroll",
      fromStatus: run.status,
      toStatus: run.status,
      performedBy: actor,
      performedByName: getActorName(req),
      employeeId,
      employeeName: freshEmployee.user?.name || freshEmployee.user?.email || "Employee"
    });

    await run.save();
    return res.json({ success: true, message: `Payroll recalculated for ${freshEmployee.user?.name || "employee"}.`, run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Unable to recalculate employee payroll." });
  }
};

// PATCH /api/employee-salaries/payroll-run/adjustment
exports.addPayrollAdjustment = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || req.query?.month || "").trim();
    const employeeId = String(req.body.employeeId || "").trim();
    const reason = String(req.body.reason || "").trim();
    const remarks = String(req.body.remarks || "").trim();
    const amount = Number(req.body.amount);
    if (!company || !/^\d{4}-\d{2}$/.test(month) || !employeeId || !reason || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Employee, fine reason and a valid amount are required." });
    }
    const run = await PayrollRun.findOne({ company, month });
    if (!run) return res.status(404).json({ success: false, message: "Generate payroll before adding a fine." });
    if (["Approved", "Locked"].includes(run.status)) {
      return res.status(409).json({ success: false, message: `${run.status} payroll must be reopened before adding a fine.` });
    }
    const index = run.employees.findIndex(employee => employeePayrollKey(employee) === employeeId || String(employee._id || "") === employeeId);
    if (index < 0) return res.status(404).json({ success: false, message: "Employee was not found in this payroll run." });

    const currentEmployee = run.employees[index];
    const availableNet = Math.round(Math.max(0,
      Number(currentEmployee.monthlyGross || 0) -
      Number(currentEmployee.totalDeductions || 0) -
      Number(currentEmployee.adjustmentDeductions || 0)
    ) * 100) / 100;
    if (Math.round(amount * 100) / 100 > availableNet) {
      return res.status(400).json({
        success: false,
        message: `Fine cannot exceed the employee's available net salary of INR ${availableNet.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
      });
    }

    const actor = req.user?._id || req.user?.id;
    const employeeName = currentEmployee?.user?.name || currentEmployee?.user?.email || "Employee";
    const adjustment = { _id: new mongoose.Types.ObjectId().toString(), type: "deduction", reason, amount: Math.round(amount * 100) / 100, remarks, createdBy: actor, createdAt: new Date() };
    const employee = withPayrollAdjustments(run.employees[index], [...(run.employees[index].adjustments || []), adjustment]);
    run.employees = run.employees.map((item, employeeIndex) => employeeIndex === index ? employee : item);
    run.totals = payrollTotals(run.employees);
    run.updatedBy = actor;
    run.auditLog.push({ action: "Add Employee Fine", fromStatus: run.status, toStatus: run.status, reason: `${reason}: ${adjustment.amount}${remarks ? ` - ${remarks}` : ""}`, performedBy: actor, performedByName: getActorName(req), employeeId, employeeName });
    await run.save();
    return res.json({ success: true, message: `${reason} fine added successfully.`, run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to add employee fine." });
  }
};

// DELETE /api/employee-salaries/payroll-run/adjustment
exports.removePayrollAdjustment = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || req.query?.month || "").trim();
    const employeeId = String(req.body?.employeeId || req.query?.employeeId || "").trim();
    const adjustmentId = String(req.body?.adjustmentId || req.query?.adjustmentId || "").trim();
    if (!company || !month || !employeeId || !adjustmentId) {
      return res.status(400).json({ success: false, message: "Month, employee ID, and adjustment ID are required." });
    }
    const run = await PayrollRun.findOne({ company, month });
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found." });
    if (["Approved", "Locked"].includes(run.status)) {
      return res.status(409).json({ success: false, message: `${run.status} payroll must be reopened before removing a fine.` });
    }
    const index = run.employees.findIndex(employee => employeePayrollKey(employee) === employeeId || String(employee._id || "") === employeeId);
    if (index < 0) return res.status(404).json({ success: false, message: "Employee was not found in this payroll run." });
    const current = run.employees[index];
    const adjustment = (current.adjustments || []).find(item => String(item._id) === adjustmentId);
    if (!adjustment) return res.status(404).json({ success: false, message: "Fine was not found." });

    const actor = req.user?._id || req.user?.id;
    const employeeName = current?.user?.name || current?.user?.email || "Employee";
    const employee = withPayrollAdjustments(current, (current.adjustments || []).filter(item => String(item._id) !== adjustmentId));
    run.employees = run.employees.map((item, employeeIndex) => employeeIndex === index ? employee : item);
    run.totals = payrollTotals(run.employees);
    run.updatedBy = actor;
    run.auditLog.push({ action: "Remove Employee Fine", fromStatus: run.status, toStatus: run.status, reason: `${adjustment.reason}: ${adjustment.amount}`, performedBy: actor, performedByName: getActorName(req), employeeId, employeeName });
    await run.save();
    return res.json({ success: true, message: "Fine removed successfully.", run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to remove employee fine." });
  }
};

// PATCH /api/employee-salaries/payroll-run/status
exports.updatePayrollRunStatus = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body.month || "").trim();
    const action = String(req.body.action || "").trim().toLowerCase();
    const reason = String(req.body.reason || "").trim();
    const run = await PayrollRun.findOne({ company, month });
    if (!run) return res.status(404).json({ success: false, message: "Generate payroll before changing its status." });

    const transitions = {
      review: { from: ["Calculated"], to: "Reviewed", label: "Review Payroll" },
      approve: { from: ["Reviewed"], to: "Approved", label: "Approve Payroll" },
      lock: { from: ["Approved"], to: "Locked", label: "Lock Payroll" },
      sendback: { from: ["Reviewed"], to: "Calculated", label: "Send Back Payroll" },
      reopen: { from: ["Approved", "Locked"], to: "Draft", label: "Reopen Payroll" }
    };
    const transition = transitions[action];
    if (!transition || !transition.from.includes(run.status)) {
      return res.status(409).json({ success: false, message: `Payroll cannot be ${action || "updated"} while status is ${run.status}.` });
    }
    if (["sendback", "reopen"].includes(action) && !reason) {
      return res.status(400).json({ success: false, message: "A correction reason is required." });
    }

    const bulkValidationError = validateBulkEmployeeStatuses(action, run.employees || []);
    if (bulkValidationError) return res.status(409).json({ success: false, message: bulkValidationError });

    const actor = req.user?._id || req.user?.id;
    const changedAt = new Date();
    const oldStatus = run.status;
    run.status = transition.to;
    run.updatedBy = actor;
    run.employees = applyBulkEmployeeTransition(action, run.employees || [], actor, changedAt);
    if (action === "reopen") {
      run.reviewedAt = null;
      run.reviewedBy = null;
      run.approvedAt = null;
      run.approvedBy = null;
      run.lockedAt = null;
      run.lockedBy = null;
    }
    if (action === "review") { run.reviewedAt = changedAt; run.reviewedBy = actor; }
    if (action === "approve") { run.approvedAt = changedAt; run.approvedBy = actor; }
    if (action === "lock") { run.lockedAt = changedAt; run.lockedBy = actor; }
    run.auditLog.push({ action: transition.label, fromStatus: oldStatus, toStatus: transition.to, reason, performedBy: actor, performedByName: getActorName(req) });
    await run.save();
    return res.json({ success: true, message: `Payroll moved to ${transition.to}.`, run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to update payroll status." });
  }
};

// PATCH /api/employee-salaries/payroll-run/employee-status
exports.updatePayrollEmployeeStatus = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body.month || "").trim();
    const employeeId = String(req.body.employeeId || "").trim();
    const action = String(req.body.action || "").trim().toLowerCase();
    if (!company || !/^\d{4}-\d{2}$/.test(month) || !employeeId || !["review", "approve", "lock", "reopen", "unlock"].includes(action)) {
      return res.status(400).json({ success: false, message: "Month, employee and a valid action are required." });
    }

    const run = await PayrollRun.findOne({ company, month });
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found." });
    const index = run.employees.findIndex(employee => employeePayrollKey(employee) === employeeId || String(employee._id || "") === employeeId);
    if (index < 0) return res.status(404).json({ success: false, message: "Employee was not found in this payroll run." });
    const current = run.employees[index];
    const normalizedAction = action === "unlock" ? "reopen" : action;
    const transitions = {
      review: { from: ["Calculated"], to: "Reviewed", label: "Review Employee Payroll" },
      approve: { from: ["Reviewed"], to: "Approved", label: "Approve Employee Payroll" },
      lock: { from: ["Approved"], to: "Locked", label: "Lock Employee Payroll" },
      reopen: { from: ["Reviewed", "Approved", "Locked"], to: "Calculated", label: "Reopen Employee Payroll" }
    };
    const transition = transitions[normalizedAction];
    if (!transition.from.includes(current.payrollStatus)) {
      return res.status(409).json({ success: false, message: `Employee payroll cannot be ${action}ed while status is ${current.payrollStatus}.` });
    }

    const actor = req.user?._id || req.user?.id;
    const employeeName = current?.user?.name || current?.user?.email || "Employee";
    const changedAt = new Date();
    run.employees = run.employees.map((employee, employeeIndex) => employeeIndex === index
      ? {
          ...employee,
          payrollStatus: transition.to,
          ...(normalizedAction === "reopen" ? { reviewedAt: null, reviewedBy: null, approvedAt: null, approvedBy: null, lockedAt: null, lockedBy: null } : {}),
          ...(normalizedAction === "review" ? { reviewedAt: changedAt, reviewedBy: actor } : {}),
          ...(normalizedAction === "approve" ? { approvedAt: changedAt, approvedBy: actor } : {}),
          ...(normalizedAction === "lock" ? { lockedAt: changedAt, lockedBy: actor } : {})
        }
      : employee);
    const derivedStatus = deriveRunStatus(run.employees);
    if (derivedStatus === "Locked") {
      run.status = derivedStatus;
      run.lockedAt = changedAt;
      run.lockedBy = actor;
    } else if (derivedStatus === "Approved") {
      run.status = derivedStatus;
      run.approvedAt = run.approvedAt || changedAt;
      run.approvedBy = run.approvedBy || actor;
    } else if (derivedStatus === "Reviewed") {
      run.status = derivedStatus;
      run.reviewedAt = run.reviewedAt || changedAt;
      run.reviewedBy = run.reviewedBy || actor;
    } else {
      run.status = derivedStatus;
    }
    run.updatedBy = actor;
    run.auditLog.push({
      action: transition.label,
      fromStatus: current.payrollStatus,
      toStatus: transition.to,
      reason: derivedStatus === "Locked" ? "All employee payrolls are now locked." : "Individual employee payroll status updated.",
      performedBy: actor,
      performedByName: getActorName(req),
      employeeId,
      employeeName
    });
    await run.save();
    return res.json({ success: true, message: `${employeeName} payroll moved to ${transition.to}.`, run: payrollRunJson(run.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to update employee payroll status." });
  }
};

// GET /api/employee-salaries/payroll-payslips?month=YYYY-MM
const fs = require("fs");
const path = require("path");
const axios = require("axios");

async function fetchLogoBase64(logoPath) {
  if (!logoPath || typeof logoPath !== "string") return null;
  const clean = logoPath.trim();
  if (!clean) return null;
  if (clean.startsWith("data:image")) return clean;
  try {
    const relativePath = clean.startsWith("/") ? clean.slice(1) : clean;
    const localFile = path.join(__dirname, "..", relativePath);
    if (fs.existsSync(localFile)) {
      const ext = path.extname(localFile).replace(".", "") || "png";
      const buffer = fs.readFileSync(localFile);
      return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buffer.toString("base64")}`;
    }
  } catch {}
  try {
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      const resp = await axios.get(clean, { responseType: "arraybuffer", timeout: 5000 });
      const contentType = resp.headers["content-type"] || "image/png";
      const base64 = Buffer.from(resp.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    }
  } catch {}
  return null;
}

exports.getPayrollPayslips = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.query.month || "").trim();
    const run = await PayrollRun.findOne({ company, month }).lean();
    if (!run) return res.status(404).json({ success: false, message: "Payroll run was not found." });
    const displayRun = await fillMissingSalaryStructures(company, payrollRunJson(run));
    const approvedEmployees = (displayRun.employees || []).filter(employee => ["Approved", "Locked"].includes(employee.payrollStatus));
    if (!approvedEmployees.length) return res.status(404).json({ success: false, message: "No employee payslip has been approved for this month." });

    const userIds = approvedEmployees.map(e => e.user?._id || e.user).filter(Boolean);
    const userDocs = await User.find({ _id: { $in: userIds } })
      .select("name email department jobRole designation employeeId empId phone profileImage status dateOfJoining bankName accountNumber ifsc bankHolderName panCard panNo pan aadharCard aadharNo aadhar aadhaar aadhaarCard dob")
      .lean();
    const userMap = new Map(userDocs.map(u => [String(u._id), u]));

    const enrichedApproved = approvedEmployees.map(employee => {
      const uId = String(employee.user?._id || employee.user || "");
      const liveUser = userMap.get(uId) || {};
      const rawUser = (typeof employee.user === "object" && employee.user !== null) ? employee.user : {};
      const panVal = liveUser.panCard || liveUser.panNo || liveUser.pan || rawUser.panCard || rawUser.panNo || rawUser.pan || "";
      const aadharVal = liveUser.aadhaar || liveUser.aadhar || liveUser.aadharCard || liveUser.aadharNo || liveUser.aadhaarNo || rawUser.aadhaar || rawUser.aadhar || rawUser.aadharCard || rawUser.aadharNo || "";
      const mergedUser = {
        ...liveUser,
        ...rawUser,
        panCard: panVal,
        panNo: panVal,
        aadharCard: aadharVal,
        aadharNo: aadharVal,
        aadhaar: aadharVal,
        dob: liveUser.dob || rawUser.dob || null,
        phone: liveUser.phone || rawUser.phone || "",
        accountNumber: liveUser.accountNumber || rawUser.accountNumber || "",
        ifsc: liveUser.ifsc || rawUser.ifsc || "",
        bankName: liveUser.bankName || rawUser.bankName || ""
      };
      return { ...employee, user: mergedUser };
    });

    let companyDoc = company ? await Company.findById(company).lean() : null;
    if (companyDoc && companyDoc.logo) {
      const logoBase64 = await fetchLogoBase64(companyDoc.logo);
      if (logoBase64) {
        companyDoc = { ...companyDoc, logoBase64 };
      }
    }
    return res.json({ success: true, company: companyDoc, run: { ...displayRun, employees: enrichedApproved } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load approved payslips." });
  }
};

// GET /api/employee-salaries/payroll-payslips/history?employeeId=...
exports.getPayslipHistory = async (req, res) => {
  try {
    const company = getCompany(req);
    const employeeId = String(req.query.employeeId || "").trim();
    if (!company || !employeeId) return res.status(400).json({ success: false, message: "Employee is required." });
    const runs = await PayrollRun.find({ company })
      .select("month status employees approvedAt lockedAt")
      .sort({ month: -1 })
      .limit(24)
      .lean();
    const payslips = runs.flatMap(run => {
      const employee = (run.employees || []).find(item => employeePayrollKey(item) === employeeId || String(item._id || "") === employeeId);
      return employee && ["Approved", "Locked"].includes(employee.payrollStatus) ? [{ month: run.month, status: employee.payrollStatus, approvedAt: employee.approvedAt || run.approvedAt, lockedAt: employee.lockedAt || run.lockedAt, netSalary: employee.monthlyNet }] : [];
    });
    return res.json({ success: true, payslips });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load previous payslips." });
  }
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));

// POST /api/employee-salaries/payroll-payslips/email
exports.emailPayslip = async (req, res) => {
  try {
    const company = getCompany(req);
    const month = String(req.body?.month || "").trim();
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!company || !/^\d{4}-\d{2}$/.test(month) || !employeeId) return res.status(400).json({ success: false, message: "Payroll month and employee are required." });
    const run = await PayrollRun.findOne({ company, month }).lean();
    if (!run) return res.status(404).json({ success: false, message: "Payroll run was not found." });
    const employee = (run.employees || []).find(item => employeePayrollKey(item) === employeeId || String(item._id || "") === employeeId);
    if (!employee || !["Approved", "Locked"].includes(employee.payrollStatus)) return res.status(404).json({ success: false, message: "Employee payslip is not approved yet." });
    const email = employee.user?.email;
    if (!email) return res.status(400).json({ success: false, message: "Employee email is not available." });
    const employeeName = employee.user?.name || "Employee";
    const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    const formatMoney = value => `INR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const deductions = Number(employee.totalDeductions || 0) + Number(employee.adjustmentDeductions || 0);
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1f2937"><h2>Payslip - ${escapeHtml(monthLabel)}</h2><p>Hello ${escapeHtml(employeeName)},</p><p>Your approved salary statement is ready.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px;border:1px solid #e5e7eb">Gross Salary</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:right">${formatMoney(employee.assignedGross)}</td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Payable Earnings</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:right">${formatMoney(employee.monthlyGross)}</td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb">Total Deductions</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:right">${formatMoney(deductions)}</td></tr><tr><td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold">Net Salary</td><td style="padding:10px;border:1px solid #e5e7eb;text-align:right;font-weight:bold">${formatMoney(employee.monthlyNet)}</td></tr></table><p style="color:#6b7280;font-size:12px">This payslip was generated from the ${escapeHtml(run.status)} payroll snapshot.</p></div>`;
    await sendEmail(email, `Payslip - ${monthLabel}`, html, { skipNotification: true });
    return res.json({ success: true, message: `Payslip emailed to ${email}.` });
  } catch (error) {
    console.error("Email payslip error:", error);
    return res.status(500).json({ success: false, message: error.message || "Unable to email payslip." });
  }
};

// GET /api/employee-salaries
exports.list = async (req, res) => {
  try {
    const company = getCompany(req);
    const companyCode = req.user?.companyCode || req.user?.company?.companyCode;

    const { status, search } = req.query;
    const filter = {};
    if (company) filter.company = company;

    if (status && status !== "all") {
      filter.status = status;
    }

    const assignments = await populateQuery(
      EmployeeSalary.find(filter).sort({ updatedAt: -1 })
    ).lean();

    const companyQueryParts = [];
    if (company) {
      companyQueryParts.push({ company });
      if (mongoose.isValidObjectId(company)) {
        companyQueryParts.push({ company: new mongoose.Types.ObjectId(company) });
      }
      companyQueryParts.push({ companyId: company });
    }
    if (companyCode) {
      companyQueryParts.push({ companyCode });
    }

    const companyFilter = companyQueryParts.length > 0 ? { $or: companyQueryParts } : {};

    const [allUsers, departments, jobRoles] = await Promise.all([
      User.find({
        $and: [
          companyFilter,
          { companyRole: { $not: /^client$/i } },
          { $or: [{ isSuperAdmin: { $ne: true } }, { isSuperAdmin: { $exists: false } }] }
        ]
      })
        .select("name email department jobRole designation employeeId empId phone profileImage status dateOfJoining bankName accountNumber ifsc bankHolderName panCard panNo pan aadharCard aadharNo aadhar dob")
        .lean(),
      Department.find(company ? { $or: [{ company }, ...(mongoose.isValidObjectId(company) ? [{ company: new mongoose.Types.ObjectId(company) }] : [])] } : {}).select("name").lean(),
      JobRole.find(company ? { $or: [{ company }, ...(mongoose.isValidObjectId(company) ? [{ company: new mongoose.Types.ObjectId(company) }] : [])] } : {})
        .populate("department", "name")
        .select("name title jobRoleName department")
        .lean()
    ]);

    const deptMap = new Map();
    departments.forEach(d => {
      if (d._id && d.name) {
        deptMap.set(String(d._id), d.name);
        deptMap.set(String(d.name).toLowerCase(), d.name);
      }
    });

    const roleMap = new Map();
    jobRoles.forEach(j => {
      const name = j.name || j.title || j.jobRoleName;
      if (name) {
        if (j._id) roleMap.set(String(j._id), name);
        roleMap.set(String(name).toLowerCase(), name);
      }
    });

    const isHexId = (str) => /^[0-9a-fA-F]{24}$/.test(String(str || "").trim());

    const assignedUserIds = new Set(assignments.filter(a => a.status === "active").map(a => String(a.user?._id || a.user)));

    const enrichedUsers = allUsers.map(u => {
      let deptName = "";
      if (typeof u.department === "object" && u.department !== null) {
        deptName = u.department.name || "";
      } else if (u.department) {
        const rawDept = String(u.department).trim();
        deptName = deptMap.get(rawDept) || deptMap.get(rawDept.toLowerCase()) || (!isHexId(rawDept) ? rawDept : "");
      }

      let roleName = "";
      if (typeof u.jobRole === "object" && u.jobRole !== null) {
        roleName = u.jobRole.name || u.jobRole.title || "";
      } else if (u.jobRole) {
        const rawRole = String(u.jobRole).trim();
        roleName = roleMap.get(rawRole) || roleMap.get(rawRole.toLowerCase()) || (!isHexId(rawRole) ? rawRole : "");
      }

      if (!roleName && u.designation && !isHexId(u.designation)) {
        roleName = u.designation;
      }

      return {
        ...u,
        department: deptName,
        departmentName: deptName,
        jobRole: roleName,
        designation: roleName,
        isSalaryAssigned: assignedUserIds.has(String(u._id))
      };
    });

    const enrichedJobRoles = jobRoles.map(j => {
      const deptName = typeof j.department === "object" && j.department !== null ? j.department.name : "";
      const deptId = typeof j.department === "object" && j.department !== null ? String(j.department._id) : String(j.department || "");
      return {
        _id: j._id,
        name: j.name || j.title || j.jobRoleName,
        departmentId: deptId,
        departmentName: deptName
      };
    });

    return res.json({
      success: true,
      assignments,
      users: enrichedUsers,
      departments: departments.map(d => ({ _id: d._id, name: d.name })),
      jobRoles: enrichedJobRoles,
      totalAssigned: assignments.filter(a => a.status === "active").length,
      totalUnassigned: allUsers.filter(u => !assignedUserIds.has(String(u._id))).length
    });
  } catch (error) {
    console.error("EmployeeSalary list error:", error);
    return res.status(500).json({ success: false, message: "Unable to load employee salary assignments." });
  }
};

// GET /api/employee-salaries/:id
exports.getById = async (req, res) => {
  try {
    const company = getCompany(req);
    if (!company || !mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid assignment ID." });
    }

    const assignment = await populateQuery(
      EmployeeSalary.findOne({ _id: req.params.id, company })
    )
      .populate("history.salaryStructure", "name code")
      .populate("history.revisedBy", "name email")
      .lean();

    if (!assignment) {
      return res.status(404).json({ success: false, message: "Salary assignment not found." });
    }

    return res.json({ success: true, assignment });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to fetch salary assignment." });
  }
};

// GET /api/employee-salaries/user/:userId
exports.getByUserId = async (req, res) => {
  try {
    const company = getCompany(req);
    const { userId } = req.params;
    if (!company || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const assignment = await populateQuery(
      EmployeeSalary.findOne({ user: userId, company, status: "active" })
    )
      .populate("history.salaryStructure", "name code")
      .populate("history.revisedBy", "name email")
      .lean();

    return res.json({ success: true, assignment });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to fetch user salary details." });
  }
};

// POST /api/employee-salaries
exports.create = async (req, res) => {
  try {
    const company = getCompany(req);
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    const {
      user: userId,
      salaryStructure: structureId,
      department = "",
      designation = "",
      dateOfJoining,
      salaryType = "monthly",
      salaryInputType = "gross",
      currency = "INR",
      payFrequency = "Monthly",
      paymentMode = "Bank Transfer",
      bankAccount = "",
      baseAmount,
      effectiveFrom,
      notes = "",
      remarks = "",
      overrides = []
    } = req.body;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Please select a valid employee." });
    }
    if (!structureId || !mongoose.isValidObjectId(structureId)) {
      return res.status(400).json({ success: false, message: "Please select a valid salary structure." });
    }
    if (baseAmount === undefined || Number(baseAmount) < 0 || Number.isNaN(Number(baseAmount))) {
      return res.status(400).json({ success: false, message: "Please enter a valid gross salary amount." });
    }
    if (!effectiveFrom || Number.isNaN(new Date(effectiveFrom).getTime())) {
      return res.status(400).json({ success: false, message: "Please select a valid effective date." });
    }

    const [targetUser, targetStructure] = await Promise.all([
      User.findOne({ _id: userId, company }).lean(),
      SalaryStructure.findOne({ _id: structureId, company }).populate("components.component").lean()
    ]);

    if (!targetUser) return res.status(404).json({ success: false, message: "Employee not found in this company." });
    if (!targetStructure) return res.status(404).json({ success: false, message: "Salary structure not found." });

    const effectiveSalaryType = targetStructure.salaryType || salaryType;
    const effectiveSalaryInputType = targetStructure.salaryInputType || salaryInputType;
    const breakdown = computeBreakdown(targetStructure, baseAmount, effectiveSalaryType, effectiveSalaryInputType, overrides);
    const expectedMonthlyGross = effectiveSalaryType === "annual" ? Number(baseAmount) / 12 : Number(baseAmount);
    if (effectiveSalaryInputType === "gross" && Math.abs(breakdown.monthlyGross - expectedMonthlyGross) > 0.01) {
      return res.status(400).json({ success: false, message: "Earning components exceed the entered Gross Salary. Please correct the salary structure." });
    }
    const loggedInUserId = req.user?._id || req.user?.id;

    const existing = await EmployeeSalary.findOne({ user: userId, company, status: "active" });

    let record;
    if (existing) {
      const previousStructure = await SalaryStructure.findOne({ _id: existing.salaryStructure, company })
        .select("name")
        .lean();
      const historyEntry = {
        salaryStructure: existing.salaryStructure,
        salaryStructureName: previousStructure?.name || targetStructure.name,
        salaryType: existing.salaryType,
        salaryInputType: existing.salaryInputType,
        currency: existing.currency,
        payFrequency: existing.payFrequency,
        paymentMode: existing.paymentMode,
        bankAccount: existing.bankAccount,
        baseAmount: existing.baseAmount,
        monthlyGross: existing.monthlyGross,
        monthlyNet: existing.monthlyNet,
        monthlyCTC: existing.monthlyCTC,
        annualCTC: existing.annualCTC,
        totalEarnings: existing.totalEarnings,
        totalDeductions: existing.totalDeductions,
        components: existing.components,
        effectiveFrom: existing.effectiveFrom,
        effectiveTo: new Date(effectiveFrom),
        notes: existing.notes || existing.remarks,
        remarks: existing.remarks || "Revised to new structure/CTC",
        revisedAt: new Date(),
        revisedBy: loggedInUserId
      };

      existing.history.push(historyEntry);
      existing.salaryStructure = structureId;
      existing.department = department || targetUser.department || "";
      existing.designation = designation || targetUser.jobRole || "";
      if (dateOfJoining) existing.dateOfJoining = new Date(dateOfJoining);
      existing.salaryType = effectiveSalaryType;
      existing.salaryInputType = effectiveSalaryInputType;
      existing.currency = currency;
      existing.payFrequency = payFrequency;
      existing.paymentMode = paymentMode;
      existing.bankAccount = bankAccount || (targetUser.bankName ? `${targetUser.bankName} - ${targetUser.accountNumber || ""}` : "");
      existing.baseAmount = Number(baseAmount);
      existing.monthlyGross = breakdown.monthlyGross;
      existing.monthlyNet = breakdown.monthlyNet;
      existing.monthlyCTC = breakdown.monthlyCTC;
      existing.annualCTC = breakdown.annualCTC;
      existing.totalEarnings = breakdown.totalEarnings;
      existing.totalDeductions = breakdown.totalDeductions;
      existing.components = breakdown.components;
      existing.effectiveFrom = new Date(effectiveFrom);
      existing.notes = String(notes || remarks || "").trim();
      existing.remarks = String(remarks || notes || "").trim();
      existing.status = "active";
      existing.updatedBy = loggedInUserId;

      record = await existing.save();
    } else {
      record = await EmployeeSalary.create({
        company,
        user: userId,
        salaryStructure: structureId,
        department: department || targetUser.department || "",
        designation: designation || targetUser.jobRole || "",
        dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : targetUser.dateOfJoining,
        salaryType: effectiveSalaryType,
        salaryInputType: effectiveSalaryInputType,
        currency,
        payFrequency,
        paymentMode,
        bankAccount: bankAccount || (targetUser.bankName ? `${targetUser.bankName} - ${targetUser.accountNumber || ""}` : ""),
        baseAmount: Number(baseAmount),
        monthlyGross: breakdown.monthlyGross,
        monthlyNet: breakdown.monthlyNet,
        monthlyCTC: breakdown.monthlyCTC,
        annualCTC: breakdown.annualCTC,
        totalEarnings: breakdown.totalEarnings,
        totalDeductions: breakdown.totalDeductions,
        components: breakdown.components,
        effectiveFrom: new Date(effectiveFrom),
        notes: String(notes || remarks || "").trim(),
        remarks: String(remarks || notes || "").trim(),
        status: "active",
        createdBy: loggedInUserId,
        updatedBy: loggedInUserId
      });
    }

    const populated = await populateQuery(EmployeeSalary.findById(record._id)).lean();

    return res.status(201).json({
      success: true,
      message: existing ? "Employee salary revised successfully." : "Employee salary assigned successfully.",
      assignment: populated
    });
  } catch (error) {
    console.error("EmployeeSalary create error:", error);
    return res.status(500).json({ success: false, message: "Unable to save salary assignment." });
  }
};

// PUT /api/employee-salaries/:id
exports.update = async (req, res) => {
  try {
    const company = getCompany(req);
    const { id } = req.params;
    if (!company || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }

    const {
      salaryStructure: structureId,
      department,
      designation,
      dateOfJoining,
      salaryType = "monthly",
      salaryInputType = "gross",
      currency = "INR",
      payFrequency = "Monthly",
      paymentMode = "Bank Transfer",
      bankAccount,
      baseAmount,
      effectiveFrom,
      status = "active",
      notes = "",
      remarks = "",
      overrides = []
    } = req.body;

    const existing = await EmployeeSalary.findOne({ _id: id, company });
    if (!existing) return res.status(404).json({ success: false, message: "Salary assignment not found." });

    const targetStructure = await SalaryStructure.findOne({ _id: structureId || existing.salaryStructure, company })
      .populate("components.component")
      .lean();

    if (!targetStructure) return res.status(404).json({ success: false, message: "Salary structure not found." });

    const effectiveBase = baseAmount !== undefined ? Number(baseAmount) : existing.baseAmount;
    const effectiveSalaryType = targetStructure.salaryType || salaryType;
    const effectiveSalaryInputType = targetStructure.salaryInputType || salaryInputType;
    const breakdown = computeBreakdown(targetStructure, effectiveBase, effectiveSalaryType, effectiveSalaryInputType, overrides);
    const expectedMonthlyGross = effectiveSalaryType === "annual" ? Number(effectiveBase) / 12 : Number(effectiveBase);
    if (effectiveSalaryInputType === "gross" && Math.abs(breakdown.monthlyGross - expectedMonthlyGross) > 0.01) {
      return res.status(400).json({ success: false, message: "Earning components exceed the entered Gross Salary. Please correct the salary structure." });
    }
    const loggedInUserId = req.user?._id || req.user?.id;

    if (existing.baseAmount !== effectiveBase || String(existing.salaryStructure) !== String(targetStructure._id)) {
      const previousStructure = await SalaryStructure.findOne({ _id: existing.salaryStructure, company })
        .select("name")
        .lean();
      existing.history.push({
        salaryStructure: existing.salaryStructure,
        salaryStructureName: previousStructure?.name || targetStructure.name,
        salaryType: existing.salaryType,
        salaryInputType: existing.salaryInputType,
        currency: existing.currency,
        payFrequency: existing.payFrequency,
        paymentMode: existing.paymentMode,
        bankAccount: existing.bankAccount,
        baseAmount: existing.baseAmount,
        monthlyGross: existing.monthlyGross,
        monthlyNet: existing.monthlyNet,
        monthlyCTC: existing.monthlyCTC,
        annualCTC: existing.annualCTC,
        totalEarnings: existing.totalEarnings,
        totalDeductions: existing.totalDeductions,
        components: existing.components,
        effectiveFrom: existing.effectiveFrom,
        effectiveTo: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        notes: existing.notes,
        remarks: existing.remarks,
        revisedAt: new Date(),
        revisedBy: loggedInUserId
      });
    }

    existing.salaryStructure = targetStructure._id;
    if (department) existing.department = department;
    if (designation) existing.designation = designation;
    if (dateOfJoining) existing.dateOfJoining = new Date(dateOfJoining);
    existing.salaryType = effectiveSalaryType;
    existing.salaryInputType = effectiveSalaryInputType;
    existing.currency = currency;
    existing.payFrequency = payFrequency;
    existing.paymentMode = paymentMode;
    if (bankAccount !== undefined) existing.bankAccount = bankAccount;
    existing.baseAmount = effectiveBase;
    existing.monthlyGross = breakdown.monthlyGross;
    existing.monthlyNet = breakdown.monthlyNet;
    existing.monthlyCTC = breakdown.monthlyCTC;
    existing.annualCTC = breakdown.annualCTC;
    existing.totalEarnings = breakdown.totalEarnings;
    existing.totalDeductions = breakdown.totalDeductions;
    existing.components = breakdown.components;
    if (effectiveFrom) existing.effectiveFrom = new Date(effectiveFrom);
    existing.status = status;
    existing.notes = String(notes || remarks || "").trim();
    existing.remarks = String(remarks || notes || "").trim();
    existing.updatedBy = loggedInUserId;

    await existing.save();
    const populated = await populateQuery(EmployeeSalary.findById(existing._id)).lean();

    return res.json({
      success: true,
      message: "Salary assignment updated successfully.",
      assignment: populated
    });
  } catch (error) {
    console.error("EmployeeSalary update error:", error);
    return res.status(500).json({ success: false, message: "Unable to update salary assignment." });
  }
};

// DELETE /api/employee-salaries/:id
exports.remove = async (req, res) => {
  try {
    const company = getCompany(req);
    const { id } = req.params;
    if (!company || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }

    const item = await EmployeeSalary.findOneAndDelete({ _id: id, company });
    if (!item) return res.status(404).json({ success: false, message: "Salary assignment not found." });

    return res.json({ success: true, message: "Salary assignment deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to delete salary assignment." });
  }
};

// DELETE /api/employee-salaries/:id/history/:historyId
exports.removeHistoryRevision = async (req, res) => {
  try {
    const company = getCompany(req);
    const { id, historyId } = req.params;
    if (!company || !mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(historyId)) {
      return res.status(400).json({ success: false, message: "Invalid salary history request." });
    }

    const assignment = await EmployeeSalary.findOne({ _id: id, company });
    if (!assignment) return res.status(404).json({ success: false, message: "Salary assignment not found." });

    const revision = assignment.history.id(historyId);
    if (!revision) return res.status(404).json({ success: false, message: "Previous salary record not found." });

    revision.deleteOne();
    assignment.updatedBy = req.user?._id || req.user?.id;
    await assignment.save();

    const populated = await populateQuery(EmployeeSalary.findById(assignment._id)).lean();
    return res.json({ success: true, message: "Previous salary record deleted successfully.", assignment: populated });
  } catch (error) {
    console.error("EmployeeSalary history delete error:", error);
    return res.status(500).json({ success: false, message: "Unable to delete previous salary record." });
  }
};
