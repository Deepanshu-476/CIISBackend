/**
 * CIISBackend/HR-CDS/utils/attendanceExportHelper.js
 *
 * Backend utility providing 100% parity with CIIS/src/utils/attendanceExport.js
 * Used for Attendance Exports across PDF, Excel (.xlsx), and CSV.
 */

const indiaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const indiaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function indiaReportDate(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    return str;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return str;
  const parts = Object.fromEntries(indiaDate.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}-${parts.month}-${parts.year}`;
}

const attendanceStatusKey = (value) => {
  const key = String(value || 'absent').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['weekend', 'weeklyoff', 'weekoff'].includes(key)) return 'weekend';
  if (key === 'onleave') return 'leave';
  return key;
};

function attendanceExportValues(record = {}) {
  const key = attendanceStatusKey(record.status);
  const approved = record.hasOvertimeApproved === true;
  const fullDay = approved && (record.isFullDayOt || record.overtimeCalculationType === 'FULL_DAY_PRESENT');
  const overtime = fullDay ? 'Full Day' : String(record.overTime || '00:00:00');
  const hasOvertime = approved && (fullDay || /[1-9]/.test(overtime));
  const labels = {
    present: 'PRESENT',
    late: 'LATE',
    halfday: 'HALF DAY',
    shortleave: 'SHORT LEAVE',
    absent: 'ABSENT',
    uninformedleave: 'UNINFORMED LEAVE',
    holiday: 'HOLIDAY',
    weekend: 'WEEKLY OFF',
    leave: 'ON LEAVE'
  };
  const baseStatus = labels[key] || String(record.status || 'ABSENT').toUpperCase();
  return {
    status: fullDay ? 'PRESENT + OVERTIME' : hasOvertime ? `${baseStatus} + OVERTIME` : baseStatus,
    overtime: approved ? overtime : '00:00:00',
    overtimeApproval: approved ? 'Approved' : 'Not approved',
    hasOvertime,
    weeklyOff: key === 'weekend',
  };
}

function attendanceExportSummary(records = []) {
  const summary = {
    total: records.length,
    present: 0,
    late: 0,
    halfDay: 0,
    absent: 0,
    uninformedLeave: 0,
    weekend: 0,
    overtime: 0,
    holiday: 0,
    leave: 0
  };
  const keys = {
    present: 'present',
    late: 'late',
    halfday: 'halfDay',
    absent: 'absent',
    uninformedleave: 'uninformedLeave',
    holiday: 'holiday',
    leave: 'leave'
  };
  for (const record of records) {
    const status = attendanceStatusKey(record.status);
    if (keys[status]) summary[keys[status]]++;
    if (record.isWeeklyOff ?? (status === 'weekend')) summary.weekend++;
    if (attendanceExportValues(record).hasOvertime) summary.overtime++;
  }
  return summary;
}

function attendanceReportTime(value) {
  if (!value) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i.test(String(value))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : indiaTime.format(date);
}

const hasNumber = (value) => value !== '' && value != null && Number.isFinite(Number(value));

function attendanceLocation(location) {
  if (!hasNumber(location?.latitude) || !hasNumber(location?.longitude)) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const coordinates = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  const details = [coordinates];
  if (hasNumber(location.accuracy)) details.push(`Accuracy ${Math.round(location.accuracy)} m`);
  if (hasNumber(location.distanceFromOfficeMeters)) details.push(`Office distance ${Math.round(location.distanceFromOfficeMeters)} m`);
  return { text: details.join(' · '), url: `https://www.google.com/maps?q=${latitude},${longitude}` };
}

function attendancePhotoUrl(value, apiBase) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const path = value.trim();
  const originPattern = /^(https?:\/\/[^/\s@?#\\]+)(?=[/?#]|$)/i;
  if (originPattern.test(path) && !/[\s\\]/.test(path)) return path;
  const origin = originPattern.exec(String(apiBase || ''))?.[1];
  const uploads = /^\/?(?:api\/)?uploads\/([^?#\s\\]+)$/i.exec(path);
  if (!origin || !uploads || uploads[1].split('/').some(part => /^(?:\.|%2e){1,2}$/i.test(part))) return '';
  return `${origin}/api/uploads/${uploads[1]}`;
}

const attendanceModeLabel = (mode) => ({
  normal: 'Normal',
  image: 'Photo',
  location: 'Location',
  both: 'Photo and location',
})[mode] || '';

function attendanceBreakDetails(record = {}) {
  const punched = (Array.isArray(record.breaks) ? record.breaks : []).filter(entry => entry?.start).map(entry => {
    const label = [entry.label || 'Break', entry.reason, entry.type].filter(Boolean).join(' / ');
    const end = entry.end ? attendanceReportTime(entry.end) : 'In progress';
    const minutes = entry.end && hasNumber(entry.minutes) ? ` (${entry.minutes} min)` : '';
    return `${label}: ${attendanceReportTime(entry.start)} – ${end}${minutes}`;
  });
  const automatic = (record.autoBreaks || []).map(entry =>
    `${entry.label}: ${attendanceReportTime(entry.start)} – ${attendanceReportTime(entry.end)} (${entry.minutes} min)`);
  const scheduled = (record.scheduledBreaks || []).map(entry =>
    `${entry.name}: ${entry.start} – ${entry.end}${entry.autoDeduct ? ' (auto deduction)' : ''}`);
  return { punched, automatic, scheduled };
}

const durationLabel = (seconds) => [
  Math.floor(seconds / 3600),
  Math.floor((seconds % 3600) / 60),
  seconds % 60,
].map(value => String(value).padStart(2, '0')).join(':');

function attendanceWorkedTime(record = {}) {
  const elapsed = record.inTime && record.outTime
    ? Math.max(0, Math.floor((new Date(record.outTime) - new Date(record.inTime)) / 1000)) || 0
    : 0;
  const breakMinutes = Math.max(0, Number(record.breakMinutes) || 0);
  const legacyAutoClockOut = record.clockOutMode === 'AUTO' && !Array.isArray(record.autoBreaks);
  const punchDuration = durationLabel(elapsed);
  const gross = record.outTime && elapsed ? punchDuration : record.grossTime || '00:00:00';
  const savedDuration = record.totalTime || record.workingHours;
  const storedNet = typeof savedDuration === 'string' ? savedDuration : '';
  const useStored = storedNet && (storedNet !== '00:00:00' || Array.isArray(record.autoBreaks) || !record.outTime);
  const net = useStored && !(legacyAutoClockOut && storedNet === punchDuration && breakMinutes)
    ? storedNet
    : durationLabel(Math.max(0, elapsed - breakMinutes * 60));
  const [hours, minutes, seconds] = net.split(':').map(Number);
  return { net, gross, breakMinutes, hours: (hours || 0) + (minutes || 0) / 60 + (seconds || 0) / 3600 };
}

function attendanceReportFields(record = {}, apiBase = '') {
  const employee = record.user || {};
  const { status, overtime, overtimeApproval, weeklyOff } = attendanceExportValues(record);
  const { punched, automatic, scheduled } = attendanceBreakDetails(record);
  const { net, gross, breakMinutes, hours } = attendanceWorkedTime(record);
  const checkOutType = record.outTime ? ((record.clockOutMode === 'AUTO' || record.autoClockout === true) ? 'Auto Clock Out' : 'Manual Clock Out') : '';
  const department = typeof employee.department === 'object' ? employee.department?.name : employee.department;
  const shiftWindow = record.shiftStart && record.shiftEnd
    ? `${attendanceReportTime(record.shiftStart)} – ${attendanceReportTime(record.shiftEnd)}`
    : '';

  return {
    'Date': indiaReportDate(record.displayDate || record.dateKey || record.date),
    'Name': employee.name || '',
    'Branch': employee.branchName || employee.branch?.name || '',
    'Department': employee.departmentName || department || '',
    'Employee Type': String(employee.employeeType || '').toUpperCase(),
    'Shift': record.shiftName || employee.shiftName || '',
    'Shift Type': record.shiftType || employee.shiftType || '',
    'Shift Hours (IST)': record.shiftTime || shiftWindow,
    'Status': status,
    'Weekly Off': (record.isWeeklyOff ?? weeklyOff) ? 'Yes' : 'No',
    'Holiday': record.holidayName || '',
    'Check In (IST)': attendanceReportTime(record.inTime || record.checkInTime || record.login),
    'Check Out (IST)': attendanceReportTime(record.outTime || record.checkOutTime || record.logout),
    'Check Out Type': checkOutType,
    'Hours Worked': net,
    'Total Hours': Number.isFinite(hours) ? hours.toFixed(2) : '0.00',
    'Gross Hours': gross,
    'Break Mode': record.breakMode || '',
    'Break (minutes)': breakMinutes,
    'Punched Breaks (IST)': punched.join('\n'),
    'Auto-Deducted Breaks (IST)': automatic.join('\n'),
    'Fixed Schedule (IST)': scheduled.length && record.scheduledBreaksFromCurrentPolicy ? ['Current policy', ...scheduled].join('\n') : scheduled.join('\n'),
    'Late By': record.lateBy || '00:00:00',
    'Early Leave': record.earlyLeave || '00:00:00',
    'Overtime': overtime,
    'OT Approval': overtimeApproval,
    'Overtime (minutes)': record.hasOvertimeApproved ? record.overTimeMinutes ?? '' : '',
    'OT Start (IST)': attendanceReportTime(record.otStartTime),
    'OT End (IST)': attendanceReportTime(record.otEndTime),
    'OT Actual (minutes)': record.otActualMinutes ?? '',
    'Current Attendance Mode': attendanceModeLabel(record.attendanceMode),
    'Check In Mode': attendanceModeLabel(record.inAttendanceMode),
    'Check Out Mode': attendanceModeLabel(record.outAttendanceMode),
    'Check In Location': attendanceLocation(record.inLocation)?.text || '',
    'Check In Map': attendanceLocation(record.inLocation)?.url || '',
    'Check In Photo': attendancePhotoUrl(record.inSelfieUrl, record.attendancePhotoBaseUrl || apiBase),
    'Check Out Location': attendanceLocation(record.outLocation)?.text || '',
    'Check Out Map': attendanceLocation(record.outLocation)?.url || '',
    'Check Out Photo': attendancePhotoUrl(record.outSelfieUrl, record.attendancePhotoBaseUrl || apiBase),
    'Notes': record.notes || '',
  };
}

function attendanceReportRows(records = [], apiBase = '') {
  const headers = Object.keys(attendanceReportFields());
  const rows = records.map(record => {
    const fields = attendanceReportFields(record, apiBase);
    return headers.map(header => fields[header]);
  });
  return { headers, rows };
}

module.exports = {
  attendanceStatusKey,
  attendanceExportValues,
  attendanceExportSummary,
  attendanceReportTime,
  attendanceLocation,
  attendancePhotoUrl,
  attendanceModeLabel,
  attendanceBreakDetails,
  attendanceWorkedTime,
  indiaReportDate,
  attendanceReportFields,
  attendanceReportRows,
};
