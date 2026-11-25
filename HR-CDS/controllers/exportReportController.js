const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { jsPDF } = require('jspdf');
const autoTableModule = require('jspdf-autotable');
const autoTable = autoTableModule.default || autoTableModule;
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Task = require('../models/Task');
const ProjectModel = require('../models/Project');
const Project = ProjectModel.Project || ProjectModel;
const Client = require('../models/Client');
const ClientTask = require('../models/ClientTask');
const ClientPlan = require('../models/ClientPlan');
const User = require('../../models/User');
try { require('../../models/Branch'); } catch (_) {}
try { require('../../models/Department'); } catch (_) {}
const {
  attendanceExportSummary,
  attendanceReportFields,
  attendanceReportRows
} = require('../utils/attendanceExportHelper');

const getEffectiveCompanyCode = (req) => {
  return String(req.user?.companyCode || req.user?.company?.companyCode || '').trim().toUpperCase();
};

const getEffectiveCompanyId = (req) => {
  return req.user?.company?._id || req.user?.company || null;
};

const isUserAdminOrHr = (req) => {
  if (req.user?.isOwner || req.user?.isSuperAdmin || req.user?.isPlatformOwner) return true;
  const role = String(
    req.user?.companyRole ||
    req.user?.role ||
    req.user?.userType ||
    ''
  ).toLowerCase();
  if (
    role.includes('admin') ||
    role.includes('hr') ||
    role.includes('superadmin') ||
    role.includes('director') ||
    role.includes('owner')
  ) {
    return true;
  }
  const allowedPages = Array.isArray(req.user?.allowedPages) ? req.user.allowedPages : [];
  return allowedPages.some((p) => {
    const norm = String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm.includes('emppattendence') || norm.includes('employeeattendance') || norm.includes('adminattendance') || norm.includes('allattendance');
  });
};

const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const formatTime = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const applyHeaderStyling = (worksheet, title, subtitle) => {
  worksheet.views = [{ showGridLines: true }];
  
  // Title row
  worksheet.mergeCells('A1', 'H1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' } // Deep Navy Blue
  };
  worksheet.getRow(1).height = 36;

  // Subtitle row
  worksheet.mergeCells('A2', 'H2');
  const subCell = worksheet.getCell('A2');
  subCell.value = subtitle;
  subCell.font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF374151' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  subCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' } // Light Gray
  };
  worksheet.getRow(2).height = 24;

  // Empty spacer row 3
  worksheet.getRow(3).height = 12;
};

const styleTableHeaders = (row) => {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' } // Primary Blue
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };
  });
};

/**
 * Universal PDF Table Generator using PDFKit
 */
const generatePdfTableReport = (res, { title, subtitle, headers, rows, filename, columnWidths }) => {
  const doc = new PDFDocument({
    layout: 'landscape',
    size: 'A4',
    margin: 28,
    bufferPages: true
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const margin = 28;
  const usableWidth = doc.page.width - (margin * 2);
  const pageHeight = doc.page.height;

  const colCount = headers.length;
  const colW = columnWidths || headers.map(() => usableWidth / colCount);

  const drawHeaderOnPage = () => {
    // Header Banner
    doc.rect(margin, margin, usableWidth, 40).fill('#0f172a');
    doc.rect(margin, margin + 38, usableWidth, 2).fill('#2563eb');

    doc.fillColor('#38bdf8').fontSize(8).font('Helvetica-Bold');
    doc.text('CIIS NETWORK • REPORTING SYSTEM', margin + 12, margin + 8);

    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
    doc.text(String(title || 'REPORT').toUpperCase(), margin + 12, margin + 20);

    if (subtitle) {
      doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica');
      doc.text(String(subtitle), margin + usableWidth - 300, margin + 20, { width: 290, align: 'right' });
    }

    // Table Header Row
    const tableHeaderY = margin + 46;
    doc.rect(margin, tableHeaderY, usableWidth, 18).fill('#2563eb');

    let x = margin;
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(String(h), x + 4, tableHeaderY + 5, { width: colW[i] - 6, align: 'left', ellipsis: true });
      x += colW[i];
    });

    return tableHeaderY + 18;
  };

  let currentY = drawHeaderOnPage();
  const rowHeight = 16;

  rows.forEach((row, rowIdx) => {
    if (currentY + rowHeight > pageHeight - margin - 20) {
      doc.addPage();
      currentY = drawHeaderOnPage();
    }

    if (rowIdx % 2 === 1) {
      doc.rect(margin, currentY, usableWidth, rowHeight).fill('#f8fafc');
    }
    doc.rect(margin, currentY + rowHeight - 0.5, usableWidth, 0.5).fill('#e2e8f0');

    let x = margin;
    doc.fillColor('#1e293b').fontSize(6.8).font('Helvetica');
    row.forEach((cellVal, colIdx) => {
      const text = cellVal !== null && cellVal !== undefined ? String(cellVal) : '-';
      doc.text(text, x + 4, currentY + 4, { width: colW[colIdx] - 6, align: 'left', ellipsis: true });
      x += colW[colIdx];
    });

    currentY += rowHeight;
  });

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#64748b').fontSize(7).font('Helvetica');
    doc.text(
      `Generated on ${new Date().toLocaleString('en-IN')} | Page ${i + 1} of ${pages.count}`,
      margin,
      pageHeight - margin + 6,
      { width: usableWidth, align: 'center' }
    );
  }

  doc.end();
};

/**
 * Specialized Landscape A3 PDF Generator matching manual export UI (Images 1-5):
 * - Uses jsPDF + jspdf-autotable with exact same configuration as EmppAttendence.jsx
 * - Dark Slate Header Banner (CIIS NETWORK • HR OPERATIONS + EMPLOYEE ATTENDANCE REPORT)
 * - 10 KPI Summary Metric Cards (Total, Present, Late, Half Day, Absent, Uninformed, Weekly Off, Overtime, Holiday, Approved Leave)
 * - Horizontal page break (horizontalPageBreak: true, horizontalPageBreakRepeat: [0, 1, 2])
 *   so 40 columns are cleanly chunked across multiple pages without squeezing!
 */
const generateAttendancePdfReport = (res, { metaLeft, datePeriodText, exportedAtText, summaryStats, headers, rows, filename }) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a3',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Header Banner Background (Dark Slate)
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 74, 'F');

  // Accent bottom line (Royal Blue)
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 72, pageWidth, 2.5, 'F');

  // Left Header text
  doc.setTextColor(56, 189, 248);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('CIIS NETWORK  •  HR OPERATIONS', 28, 24);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('EMPLOYEE ATTENDANCE REPORT', 28, 44);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(metaLeft || 'Department: All Departments   |   Filter: All Status', 28, 60);

  // Right Header text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(datePeriodText || `Date: ${formatDate(new Date())}`, pageWidth - 28, 28, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(exportedAtText || `Exported: ${new Date().toLocaleString('en-IN')}   |   Total Records: ${rows.length}`, pageWidth - 28, 44, { align: 'right' });

  // 2. Summary KPI Metric Cards (startY = 82)
  const kpis = [
    { label: 'TOTAL RECORDS', value: summaryStats.total || 0, fill: [241, 245, 249], border: [203, 213, 225], text: [30, 41, 59] },
    { label: 'PRESENT', value: summaryStats.present || 0, fill: [236, 253, 245], border: [167, 243, 208], text: [22, 101, 52] },
    { label: 'LATE', value: summaryStats.late || 0, fill: [254, 243, 199], border: [253, 230, 138], text: [180, 83, 9] },
    { label: 'HALF DAY', value: summaryStats.halfDay || 0, fill: [224, 242, 254], border: [186, 230, 253], text: [3, 105, 161] },
    { label: 'ABSENT', value: summaryStats.absent || 0, fill: [254, 226, 226], border: [254, 202, 202], text: [185, 28, 28] },
    { label: 'UNINFORMED', value: summaryStats.uninformedLeave || 0, fill: [255, 237, 213], border: [254, 215, 170], text: [194, 65, 12] },
    { label: 'WEEKLY OFF', value: summaryStats.weekend || 0, fill: [241, 245, 249], border: [203, 213, 225], text: [71, 85, 105] },
    { label: 'OVERTIME', value: summaryStats.overtime || 0, fill: [243, 232, 255], border: [233, 213, 255], text: [109, 40, 217] },
    { label: 'HOLIDAY', value: summaryStats.holiday || 0, fill: [243, 232, 255], border: [233, 213, 255], text: [109, 40, 217] },
    { label: 'APPROVED LEAVE', value: summaryStats.leave || 0, fill: [243, 232, 255], border: [233, 213, 255], text: [109, 40, 217] },
  ];

  const kpiMargin = 28;
  const kpiGap = 8;
  const totalKpiWidth = pageWidth - (kpiMargin * 2);
  const cardWidth = (totalKpiWidth - (kpis.length - 1) * kpiGap) / kpis.length;
  const cardHeight = 36;
  const cardY = 82;

  kpis.forEach((kpi, idx) => {
    const cx = kpiMargin + idx * (cardWidth + kpiGap);
    doc.setFillColor(kpi.fill[0], kpi.fill[1], kpi.fill[2]);
    doc.setDrawColor(kpi.border[0], kpi.border[1], kpi.border[2]);
    doc.roundedRect(cx, cardY, cardWidth, cardHeight, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(kpi.text[0], kpi.text[1], kpi.text[2]);
    doc.text(String(kpi.value || 0), cx + cardWidth / 2, cardY + 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + cardWidth / 2, cardY + 28, { align: 'center' });
  });

  autoTable(doc, {
    startY: 126,
    head: [headers],
    body: rows,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',
      valign: 'middle',
      cellPadding: 4,
    },
    bodyStyles: {
      fontSize: 7.2,
      textColor: [30, 41, 59],
      valign: 'middle',
      cellPadding: 3.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: [0, 1, 2],
    styles: { overflow: 'linebreak' },
    columnStyles: Object.fromEntries(headers.map((header, index) => [
      index, { cellWidth: /Breaks|Schedule|Location|Photo|Map|Notes/.test(header) ? 160 : 85 },
    ])),
    didDrawCell: ({ section, column, cell }) => {
      if (section !== 'body' || !/(Map|Photo)$/.test(headers[column.index]) || !cell.raw) return;
      doc.link(cell.x, cell.y, cell.width, cell.height, { url: cell.raw });
    },
    didDrawPage: (data) => {
      const currentPage = data.pageNumber;
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      
      doc.setDrawColor(226, 232, 240);
      doc.line(28, pageHeight - 20, pageWidth - 28, pageHeight - 20);

      doc.text('CIIS Network  •  Confidential Employee Attendance Report', 28, pageHeight - 10);
      doc.text('Page ' + currentPage, pageWidth - 28, pageHeight - 10, { align: 'right' });
    },
    margin: { left: 28, right: 28, bottom: 26 },
  });

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename || 'attendance_report.pdf'}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.end(pdfBuffer);
};

/**
 * 1. ATTENDANCE EXPORT (Self, Today, Monthly, Single User)
 */
exports.exportAttendanceReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const isAdmin = isUserAdminOrHr(req);
    const rawType = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const requestedType = String(rawType || (isAdmin ? 'all' : 'self')).toLowerCase();
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const queryDate = req.query.date; // e.g. 'today' or '2026-11-20'
    const targetUserId = req.query.userId;

    let filter = {};
    let subtitle = `Generated on: ${formatDate(new Date())}`;

    // Determine target users: non-Admin/HR employees are strictly restricted to their own attendance
    if (requestedType === 'self' || !isAdmin) {
      filter.user = req.user._id;
      subtitle = `Attendance for: ${req.user.name || 'Current User'} | ${subtitle}`;
    } else if (targetUserId) {
      filter.user = targetUserId;
      const targetUser = await User.findById(targetUserId).select('name email');
      subtitle = `Attendance for: ${targetUser?.name || targetUserId} | ${subtitle}`;
    } else if (req.query.userName) {
      const targetUser = await User.findOne({
        name: { $regex: new RegExp(req.query.userName, 'i') },
        companyCode
      }).select('_id name email');
      if (targetUser) {
        filter.user = targetUser._id;
        subtitle = `Attendance for: ${targetUser.name} | ${subtitle}`;
      } else {
        subtitle = `Attendance for: ${req.query.userName} | ${subtitle}`;
      }
    } else {
      // Admin company-wide
      subtitle = `Company-Wide Attendance (${companyCode}) | ${subtitle}`;
    }

    // Determine date range
    const MONTH_MAP = {
      january: 0, jan: 0, 'जनवरी': 0,
      february: 1, feb: 1, 'फ़रवरी': 1, 'फरवरी': 1,
      march: 2, mar: 2, 'मार्च': 2,
      april: 3, apr: 3, 'अप्रैल': 3,
      may: 4, 'मई': 4,
      june: 5, jun: 5, 'जून': 5,
      july: 6, jul: 6, 'जुलाई': 6,
      august: 7, aug: 7, 'अगस्त': 7,
      september: 8, sep: 8, sept: 8, 'सितंबर': 8,
      october: 9, oct: 9, 'अक्टूबर': 9,
      november: 10, nov: 10, 'नवंबर': 10,
      december: 11, dec: 11, 'दिसंबर': 11
    };
    if (queryDate === 'yesterday' || requestedType === 'yesterday') {
      const yStart = new Date();
      yStart.setDate(yStart.getDate() - 1);
      yStart.setHours(0, 0, 0, 0);
      const yEnd = new Date(yStart);
      yEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: yStart, $lte: yEnd };
      subtitle = `Yesterday's Attendance (${formatDate(yStart)}) | ${subtitle}`;
    } else if (queryDate === 'this_week' || requestedType === 'this_week' || queryDate === 'week') {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const wStart = new Date(now.setDate(diff));
      wStart.setHours(0, 0, 0, 0);
      const wEnd = new Date();
      wEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: wStart, $lte: wEnd };
      subtitle = `This Week Attendance (${formatDate(wStart)} to ${formatDate(wEnd)}) | ${subtitle}`;
    } else if (queryDate === 'last_week' || requestedType === 'last_week') {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7; // Last Monday
      const lwStart = new Date(now.setDate(diff));
      lwStart.setHours(0, 0, 0, 0);
      const lwEnd = new Date(lwStart);
      lwEnd.setDate(lwEnd.getDate() + 6);
      lwEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: lwStart, $lte: lwEnd };
      subtitle = `Last Week Attendance (${formatDate(lwStart)} to ${formatDate(lwEnd)}) | ${subtitle}`;
    } else if (requestedType === 'monthly' || req.query.month || queryDate === 'last_month' || requestedType === 'last_month' || queryDate === 'this_month') {
      const now = new Date();
      let month = now.getMonth();
      let year = now.getFullYear();
      if (req.query.month === 'last' || queryDate === 'last_month' || requestedType === 'last_month') {
        month = month - 1;
        if (month < 0) {
          month = 11;
          year = year - 1;
        }
      } else if (req.query.month && typeof req.query.month === 'string' && MONTH_MAP[req.query.month.toLowerCase()] !== undefined) {
        month = MONTH_MAP[req.query.month.toLowerCase()];
        if (req.query.year && !isNaN(parseInt(req.query.year, 10))) year = parseInt(req.query.year, 10);
      } else if (req.query.month && !isNaN(parseInt(req.query.month, 10))) {
        month = parseInt(req.query.month, 10) - 1;
        if (req.query.year && !isNaN(parseInt(req.query.year, 10))) year = parseInt(req.query.year, 10);
      }
      const s = new Date(year, month, 1, 0, 0, 0, 0);
      const e = new Date(year, month + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: s, $lte: e };
      subtitle = `Month: ${s.toLocaleString('default', { month: 'long', year: 'numeric' })} | ${subtitle}`;
    } else if (queryDate && queryDate !== 'today' && !isNaN(new Date(queryDate).getTime())) {
      const dStart = new Date(queryDate);
      dStart.setHours(0, 0, 0, 0);
      const dEnd = new Date(dStart);
      dEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: dStart, $lte: dEnd };
      subtitle = `Attendance for: ${formatDate(dStart)} | ${subtitle}`;
    } else if (req.query.startDate && req.query.endDate) {
      const s = new Date(req.query.startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(req.query.endDate);
      e.setHours(23, 59, 59, 999);
      filter.date = { $gte: s, $lte: e };
      subtitle = `Date Range: ${formatDate(s)} to ${formatDate(e)} | ${subtitle}`;
    } else {
      // Default: today
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
      subtitle = `Today's Attendance (${formatDate(startOfDay)}) | ${subtitle}`;
    }

    let records = [];
    if (requestedType === 'self' || !isAdmin || targetUserId || req.query.userName) {
      records = await Attendance.find(filter)
        .populate('user', 'name email employeeId department departmentName jobRole branch branchName employeeType shift shiftName shiftType')
        .sort({ date: -1, 'user.name': 1 })
        .lean();

      if (records.length === 0 && filter.user) {
        const gteDate = filter.date?.$gte ? new Date(filter.date.$gte) : new Date();
        const lteDate = filter.date?.$lte ? new Date(filter.date.$lte) : new Date();
        const diffDays = Math.round((lteDate - gteDate) / (1000 * 60 * 60 * 24));
        if (diffDays <= 1) {
          const singleUser = await User.findById(filter.user)
            .populate('branch', 'name branchName branchCode')
            .populate('department', 'name')
            .lean();
          if (singleUser) {
            const targetDateStr = gteDate.toISOString().slice(0, 10);
            records = [{
              _id: `absent_${singleUser._id}_${targetDateStr}`,
              user: singleUser,
              date: gteDate,
              inTime: null,
              outTime: null,
              hoursWorked: '00:00:00',
              totalHours: 0,
              lateBy: '00:00:00',
              earlyLeave: '00:00:00',
              overTime: '00:00:00',
              status: 'ABSENT',
              weeklyOff: false,
              isHoliday: false,
              isClockedIn: false
            }];
          }
        }
      }
    } else {
      // Company-wide: Include ALL active company employees (present, late, half day, or absent)
      // exactly matching EmppAttendence.jsx manual export!
      const userQuery = {
        $or: [
          { companyCode },
          { company: getEffectiveCompanyId(req) }
        ],
        isActive: { $ne: false },
        companyRole: { $not: /^client$/i }
      };

      if (req.query.branch && req.query.branch !== 'all') {
        userQuery.branch = req.query.branch;
      }

      const companyUsers = await User.find(userQuery)
        .populate('branch', 'name branchName branchCode')
        .populate('department', 'name')
        .sort({ name: 1 })
        .lean();

      const userIds = companyUsers.map(u => u._id);
      filter.user = { $in: userIds };

      const existingRecords = await Attendance.find(filter)
        .populate('user', 'name email employeeId department departmentName jobRole branch branchName employeeType shift shiftName shiftType')
        .sort({ date: -1, 'user.name': 1 })
        .lean();

      const gteDate = filter.date?.$gte ? new Date(filter.date.$gte) : new Date();
      const lteDate = filter.date?.$lte ? new Date(filter.date.$lte) : new Date();
      const diffDays = Math.round((lteDate - gteDate) / (1000 * 60 * 60 * 24));

      const attendanceMap = {};
      existingRecords.forEach(rec => {
        const uId = String(rec.user?._id || rec.user?.id || rec.user || '');
        const dKey = rec.date ? new Date(rec.date).toISOString().slice(0, 10) : '';
        if (uId && dKey) {
          attendanceMap[`${dKey}_${uId}`] = rec;
        }
      });

      if (diffDays <= 1) {
        const targetDateObj = gteDate;
        const targetDateStr = targetDateObj.toISOString().slice(0, 10);
        records = companyUsers.map(u => {
          const uId = String(u._id || u.id);
          const existing = attendanceMap[`${targetDateStr}_${uId}`] || existingRecords.find(r => String(r.user?._id || r.user?.id || r.user) === uId);
          if (existing) return existing;
          return {
            _id: `absent_${uId}_${targetDateStr}`,
            user: u,
            date: targetDateObj,
            inTime: null,
            outTime: null,
            hoursWorked: '00:00:00',
            totalHours: 0,
            lateBy: '00:00:00',
            earlyLeave: '00:00:00',
            overTime: '00:00:00',
            status: 'ABSENT',
            weeklyOff: false,
            isHoliday: false,
            isClockedIn: false
          };
        });
      } else if (diffDays <= 31) {
        const days = [];
        const cur = new Date(gteDate);
        while (cur <= lteDate) {
          days.push(new Date(cur));
          cur.setDate(cur.getDate() + 1);
        }
        days.forEach(day => {
          const dStr = day.toISOString().slice(0, 10);
          companyUsers.forEach(u => {
            const uId = String(u._id || u.id);
            const existing = attendanceMap[`${dStr}_${uId}`];
            if (existing) {
              records.push(existing);
            } else {
              records.push({
                _id: `absent_${uId}_${dStr}`,
                user: u,
                date: new Date(day),
                inTime: null,
                outTime: null,
                hoursWorked: '00:00:00',
                totalHours: 0,
                lateBy: '00:00:00',
                earlyLeave: '00:00:00',
                overTime: '00:00:00',
                status: 'ABSENT',
                weeklyOff: false,
                isHoliday: false,
                isClockedIn: false
              });
            }
          });
        });
      } else {
        records = existingRecords;
      }
    }

    const { headers, rows } = attendanceReportRows(records);
    const summaryStats = attendanceExportSummary(records);

    const deptName = req.query.department || 'All Departments';
    const metaLeft = `Department: ${deptName}   |   Filter: All Status`;
    const datePeriodText = subtitle.split('|')[0]?.trim() || `Date: ${formatDate(new Date())}`;
    const exportedAtText = `Exported: ${new Date().toLocaleString('en-IN')}   |   Total Records: ${records.length}`;
    const filenameBase = `Attendance_Report_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'pdf') {
      const pdfFilename = `${filenameBase}.pdf`;
      return generateAttendancePdfReport(res, {
        metaLeft,
        datePeriodText,
        exportedAtText,
        summaryStats,
        headers,
        rows,
        filename: pdfFilename
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Attendance');
    applyHeaderStyling(worksheet, 'EMPLOYEE ATTENDANCE REPORT', `${metaLeft} | ${datePeriodText} | Total Records: ${records.length}`);

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    rows.forEach((r) => {
      const row = worksheet.addRow(r);
      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        // Status column is column 9
        if (colNumber === 9) {
          const st = String(cell.value || '').toUpperCase();
          if (st.includes('PRESENT')) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF16A34A' } };
          } else if (st.includes('ABSENT')) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFDC2626' } };
          } else if (st.includes('HALF') || st.includes('LATE')) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFD97706' } };
          } else if (st.includes('OVERTIME') || st.includes('HOLIDAY') || st.includes('LEAVE')) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF7C3AED' } };
          }
        }
      });
    });

    // KPI Summary Section matching EmppAttendence.jsx
    worksheet.addRow([]);
    const summaryHeader = worksheet.addRow(['SUMMARY REPORT']);
    summaryHeader.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    const kpiSummaryItems = [
      ['Total Records', summaryStats.total],
      ['Present', summaryStats.present],
      ['Late', summaryStats.late],
      ['Half Day', summaryStats.halfDay],
      ['Absent', summaryStats.absent],
      ['Uninformed Leave', summaryStats.uninformedLeave],
      ['Weekly Off', summaryStats.weekend],
      ['Overtime', summaryStats.overtime],
      ['Holiday', summaryStats.holiday],
      ['Approved Leave', summaryStats.leave],
    ];
    kpiSummaryItems.forEach(([label, count]) => {
      const sRow = worksheet.addRow([label, count]);
      sRow.font = { name: 'Arial', size: 9.5 };
    });

    // Auto-fit column widths
    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 45);
      });
      column.width = maxLen;
    });

    const filename = `${filenameBase}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      const escapeCsv = (val) => {
        const text = String(val ?? '');
        return `"${text.replace(/"/g, '""')}"`;
      };
      const csvLines = [
        headers.map(escapeCsv).join(','),
        ...rows.map(r => r.map(escapeCsv).join(',')),
        '',
        '"SUMMARY REPORT"',
        ...kpiSummaryItems.map(([label, count]) => `"${label}",${count}`)
      ];
      const csvContent = '\uFEFF' + csvLines.join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvContent);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportAttendanceReport] error:', error);
    return res.status(500).json({ success: false, message: 'Attendance report export failed', error: error.message });
  }
};

/**
 * 2. TASKS EXPORT (All Tasks, Single User Tasks, Today's Tasks, Filtered)
 */
exports.exportTasksReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const isAdmin = isUserAdminOrHr(req);
    const rawType = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const requestedType = String(rawType || (isAdmin ? 'all' : 'self')).toLowerCase();
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const queryDate = req.query.date; // 'today' or YYYY-MM-DD
    const targetUserId = req.query.userId;
    const targetUserName = req.query.userName;

    let filter = {
      $or: [
        { companyCode },
        { company: getEffectiveCompanyId(req) }
      ]
    };
    let subtitle = `Generated on: ${formatDate(new Date())}`;

    // Target User Scoping
    if (requestedType === 'self' || (!isAdmin && !targetUserId)) {
      filter.$and = [
        {
          $or: [
            { assignedTo: req.user._id },
            { assignedUsers: req.user._id },
            { createdBy: req.user._id }
          ]
        }
      ];
      subtitle = `Tasks for: ${req.user.name || 'Current User'} | ${subtitle}`;
    } else if (targetUserId) {
      filter.$and = [
        {
          $or: [
            { assignedTo: targetUserId },
            { assignedUsers: targetUserId }
          ]
        }
      ];
      const u = await User.findById(targetUserId).select('name');
      subtitle = `Tasks for: ${u?.name || targetUserId} | ${subtitle}`;
    } else if (targetUserName) {
      const u = await User.findOne({
        name: { $regex: new RegExp(targetUserName, 'i') },
        companyCode
      }).select('_id name');
      if (u) {
        filter.$and = [
          {
            $or: [
              { assignedTo: u._id },
              { assignedUsers: u._id }
            ]
          }
        ];
        subtitle = `Tasks for: ${u.name} | ${subtitle}`;
      }
    } else {
      subtitle = `All Tasks Report (${companyCode}) | ${subtitle}`;
    }

    // Date filtering (today, range)
    if (queryDate === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
      subtitle = `Today's Tasks (${formatDate(startOfDay)}) | ${subtitle}`;
    } else if (req.query.startDate && req.query.endDate) {
      const s = new Date(req.query.startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(req.query.endDate);
      e.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: s, $lte: e };
      subtitle = `Date Range: ${formatDate(s)} to ${formatDate(e)} | ${subtitle}`;
    }

    if (req.query.status) {
      filter.status = new RegExp(req.query.status, 'i');
    }

    const tasks = await Task.find(filter)
      .select('title description taskType assignedUsers createdBy dueDate dueDateTime status overallStatus priority createdAt completionDate completedAt projectId')
      .populate('assignedUsers', 'name email employeeId')
      .populate('createdBy', 'name')
      .sort({ _id: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Tasks Report');
    applyHeaderStyling(worksheet, 'CIIS NETWORK - TASKS REPORT', subtitle);

    const headers = [
      'Task Title',
      'Description',
      'Task Type',
      'Assigned To',
      'Created By',
      'Due Date',
      'Status',
      'Priority',
      'Created Date',
      'Completed Date'
    ];

    if (format === 'pdf') {
      const pdfRows = tasks.map((t) => {
        let assignees = [];
        if (Array.isArray(t.assignedUsers)) {
          t.assignedUsers.forEach(u => {
            if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
            else if (typeof u === 'string' && !assignees.includes(u)) assignees.push(u);
          });
        }
        const taskStatus = t.overallStatus || t.status || 'pending';
        return [
          t.title || 'Untitled',
          t.description || '-',
          t.taskType || (t.projectId ? 'Project Task' : 'General Task'),
          assignees.join(', ') || 'Unassigned',
          t.createdBy?.name || '-',
          formatDate(t.dueDate || t.dueDateTime),
          String(taskStatus).toUpperCase(),
          String(t.priority || 'medium').toUpperCase(),
          formatDate(t.createdAt),
          formatDate(t.completionDate || t.completedAt)
        ];
      });
      if (pdfRows.length === 0) {
        pdfRows.push(['No tasks found matching criteria', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
      }
      const pdfFilename = `Tasks_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
      return generatePdfTableReport(res, {
        title: 'CIIS NETWORK - TASKS REPORT',
        subtitle,
        headers,
        rows: pdfRows,
        filename: pdfFilename
      });
    }

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    if (tasks.length === 0) {
      const emptyRow = worksheet.addRow(['No tasks found matching criteria', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
      emptyRow.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF6B7280' } };
      emptyRow.height = 22;
    } else {
      tasks.forEach((t) => {
        let assignees = [];
        if (Array.isArray(t.assignedUsers)) {
          t.assignedUsers.forEach(u => {
            if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
            else if (typeof u === 'string' && !assignees.includes(u)) assignees.push(u);
          });
        }

        const taskStatus = t.overallStatus || t.status || 'pending';
        const row = worksheet.addRow([
          t.title || 'Untitled',
          t.description || '-',
          t.taskType || (t.projectId ? 'Project Task' : 'General Task'),
          assignees.join(', ') || 'Unassigned',
          t.createdBy?.name || '-',
          formatDate(t.dueDate || t.dueDateTime),
          String(taskStatus).toUpperCase(),
          String(t.priority || 'medium').toUpperCase(),
          formatDate(t.createdAt),
          formatDate(t.completionDate || t.completedAt)
        ]);

        row.height = 20;
        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
          if (colNumber === 7) {
            // Status color
            const st = String(cell.value || '').toUpperCase();
            if (st.includes('COMPLETED') || st.includes('APPROVED')) {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
            } else if (st.includes('OVERDUE') || st.includes('REJECTED')) {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
            } else {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD97706' } };
            }
          }
        });
      });
    }

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const filename = `Tasks_Report_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Tasks report export failed', error: error.message });
  }
};

/**
 * 3. PROJECT TASKS EXPORT (All Tasks of a Specific Project, with Team Member Grouping)
 */
exports.exportProjectTasksReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const projectId = req.params.projectId || req.query.projectId;
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }

    let project = null;
    if (mongoose.Types.ObjectId.isValid(projectId)) {
      project = await Project.findById(projectId)
        .populate('managers', 'name email')
        .populate('users', 'name email employeeId')
        .populate('tasks.assignedTo', 'name email')
        .populate('tasks.assignedUsers', 'name email')
        .populate('tasks.createdBy', 'name')
        .lean();
    } else {
      // Find by project name
      project = await Project.findOne({
        projectName: new RegExp(projectId, 'i'),
        companyCode
      })
        .populate('managers', 'name email')
        .populate('users', 'name email employeeId')
        .populate('tasks.assignedTo', 'name email')
        .populate('tasks.assignedUsers', 'name email')
        .populate('tasks.createdBy', 'name')
        .lean();
    }

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const tasks = project.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => ['completed', 'approved'].includes(String(t.status || '').toLowerCase())).length;
    const progressRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Project Tasks');

    const subtitle = `Project: ${project.projectName} | Status: ${(project.status || 'active').toUpperCase()} | Progress: ${progressRate}% (${completedTasks}/${totalTasks}) | Deadline: ${formatDate(project.endDate)}`;
    applyHeaderStyling(worksheet, `PROJECT REPORT - ${project.projectName.toUpperCase()}`, subtitle);

    const headers = [
      'Task Title',
      'Description',
      'Assigned Team Members',
      'Priority',
      'Status',
      'Due Date',
      'Checkpoints Done / Total',
      'Remarks Count'
    ];

    if (format === 'pdf') {
      const pdfRows = tasks.map((t) => {
        let assignees = [];
        if (Array.isArray(t.assignedUsers)) {
          t.assignedUsers.forEach(u => {
            if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
          });
        }
        if (t.assignedTo?.name && !assignees.includes(t.assignedTo.name)) {
          assignees.push(t.assignedTo.name);
        }
        const totalCheckpoints = Array.isArray(t.checkpoints) ? t.checkpoints.length : 0;
        const doneCheckpoints = Array.isArray(t.checkpoints) ? t.checkpoints.filter(c => c.completed).length : 0;
        const checkText = totalCheckpoints > 0 ? `${doneCheckpoints} / ${totalCheckpoints}` : 'None';
        const remarksCount = Array.isArray(t.remarks) ? t.remarks.length : 0;

        return [
          t.title || 'Untitled',
          t.description || '-',
          assignees.join(', ') || 'Unassigned',
          String(t.priority || 'medium').toUpperCase(),
          String(t.status || 'pending').toUpperCase(),
          formatDate(t.dueDate || t.dueDateTime),
          checkText,
          remarksCount
        ];
      });
      if (pdfRows.length === 0) {
        pdfRows.push(['No tasks yet in this project', '-', '-', '-', '-', '-', '-', '-']);
      }
      const safeName = project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const pdfFilename = `Project_${safeName}_Tasks_${new Date().toISOString().slice(0, 10)}.pdf`;
      return generatePdfTableReport(res, {
        title: `PROJECT REPORT - ${project.projectName.toUpperCase()}`,
        subtitle,
        headers,
        rows: pdfRows,
        filename: pdfFilename
      });
    }

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    if (tasks.length === 0) {
      const emptyRow = worksheet.addRow(['No tasks created yet for this project', '-', '-', '-', '-', '-', '-', '-']);
      emptyRow.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF6B7280' } };
      emptyRow.height = 22;
    } else {
      tasks.forEach((t) => {
        let assignees = [];
        if (t.assignedTo?.name) assignees.push(t.assignedTo.name);
        if (Array.isArray(t.assignedUsers)) {
          t.assignedUsers.forEach(u => {
            if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
          });
        }

        const checkpoints = t.checkpoints || [];
        const cpDone = checkpoints.filter(c => c.completed).length;
        const cpStr = checkpoints.length > 0 ? `${cpDone} / ${checkpoints.length}` : '-';

        const row = worksheet.addRow([
          t.title || 'Untitled',
          t.description || '-',
          assignees.join(', ') || 'Team',
          (t.priority || 'medium').toUpperCase(),
          (t.status || 'pending').toUpperCase(),
          formatDate(t.dueDate || t.dueDateTime),
          cpStr,
          Array.isArray(t.remarks) ? t.remarks.length : 0
        ]);

        row.height = 20;
        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
          if (colNumber === 5) {
            const st = String(cell.value || '').toUpperCase();
            if (st.includes('COMPLETED')) {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
            } else if (st.includes('OVERDUE')) {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
            }
          }
        });
      });
    }

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const safeName = project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Project_${safeName}_Tasks_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportProjectTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Project tasks export failed', error: error.message });
  }
};

/**
 * 4. CLIENTS MASTER SHEET EXPORT
 * Full metrics: Client Name, Company, Subscription Plan, Subscription Status,
 * Expiry Date, Days Left / Overdue, Total Tasks, Completed Tasks, Pending Tasks, Active Services
 */
exports.exportClientsMasterReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const format = String(req.query.format || 'xlsx').toLowerCase();

    // Fetch all clients in company
    const clients = await Client.find({
      $or: [
        { companyCode },
        { companyId: getEffectiveCompanyId(req) }
      ]
    })
      .populate('activeClientPlan')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch all client tasks to aggregate metrics per client
    const allClientTasks = await ClientTask.find({
      clientId: { $in: clients.map(c => c._id) }
    }).select('clientId status service').lean();

    // Group tasks by clientId
    const clientTaskMap = new Map();
    allClientTasks.forEach((task) => {
      const cId = String(task.clientId);
      if (!clientTaskMap.has(cId)) {
        clientTaskMap.set(cId, { total: 0, completed: 0, pending: 0, services: new Set() });
      }
      const stats = clientTaskMap.get(cId);
      stats.total += 1;
      const status = String(task.status || '').toLowerCase();
      if (['completed', 'approved'].includes(status)) {
        stats.completed += 1;
      } else {
        stats.pending += 1;
      }
      if (task.service) stats.services.add(task.service);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Clients Master Report');

    const subtitle = `Total Clients: ${clients.length} | Generated on: ${formatDate(new Date())}`;
    applyHeaderStyling(worksheet, 'CIIS NETWORK - CLIENTS & SUBSCRIPTIONS MASTER REPORT', subtitle);

    const headers = [
      'Client Name',
      'Company Name',
      'Email',
      'Phone',
      'Active Plan Name',
      'Subscription Status',
      'Start Date',
      'Expiry Date (Valid Till)',
      'Validity Status',
      'Total Tasks',
      'Completed Tasks',
      'Pending Tasks',
      'Completion Rate (%)',
      'Active Services'
    ];

    if (format === 'pdf') {
      const pdfHeaders = [
        'Client', 'Company', 'Email', 'Active Plan', 'Sub Status',
        'Valid Till', 'Validity', 'Tasks (Done/Total)', 'Rate', 'Active Services'
      ];
      const pdfRows = clients.map((c) => {
        const cId = String(c._id);
        const taskStats = clientTaskMap.get(cId) || { total: 0, completed: 0, pending: 0, services: new Set() };
        let activeSub = null;
        if (Array.isArray(c.subscription) && c.subscription.length > 0) {
          activeSub = c.subscription.find(s => s.status === 'Active') || c.subscription[c.subscription.length - 1];
        }
        const planName = c.activeClientPlan?.planName || activeSub?.planName || c.plan || 'None';
        const subStatus = activeSub?.status || (c.companyStatus === 'Active' ? 'Active' : 'Expired');
        const expiryDate = formatDate(activeSub?.endDate || activeSub?.expiryDate);

        let validityStatus = 'Active';
        if (activeSub?.endDate) {
          const exp = new Date(activeSub.endDate);
          if (exp < now) {
            validityStatus = 'Expired';
          } else {
            const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
            validityStatus = `${diffDays}d left`;
          }
        }
        const totalT = taskStats.total;
        const compT = taskStats.completed;
        const rate = totalT > 0 ? `${Math.round((compT / totalT) * 100)}%` : '0%';
        const servicesList = taskStats.services?.size > 0 ? Array.from(taskStats.services).join(', ') : (c.services?.join(', ') || 'None');

        return [
          c.client || 'Unknown',
          c.company || '-',
          c.email || '-',
          planName,
          subStatus,
          expiryDate,
          validityStatus,
          `${compT} / ${totalT}`,
          rate,
          servicesList
        ];
      });

      const pdfFilename = `Clients_Master_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
      return generatePdfTableReport(res, {
        title: 'CIIS NETWORK - CLIENTS & SUBSCRIPTIONS MASTER REPORT',
        subtitle,
        headers: pdfHeaders,
        rows: pdfRows,
        filename: pdfFilename
      });
    }

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    const now = new Date();

    clients.forEach((c) => {
      const cId = String(c._id);
      const taskStats = clientTaskMap.get(cId) || { total: 0, completed: 0, pending: 0, services: new Set() };
      
      // Determine subscription info
      let activeSub = null;
      if (Array.isArray(c.subscription) && c.subscription.length > 0) {
        // Find newest or active subscription
        activeSub = c.subscription.find(s => s.status === 'Active') || c.subscription[c.subscription.length - 1];
      }

      const planName = activeSub?.planName || c.activeClientPlan?.name || 'Standard Plan';
      const startDate = activeSub?.startDate ? formatDate(activeSub.startDate) : '-';
      const endDate = activeSub?.endDate ? formatDate(activeSub.endDate) : '-';
      
      let subStatus = activeSub?.status || 'No Subscription';
      let validityNotice = '-';

      if (activeSub?.endDate) {
        const expDate = new Date(activeSub.endDate);
        const diffMs = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          subStatus = 'Active';
          validityNotice = `${diffDays} days left`;
        } else {
          subStatus = 'Expired';
          validityNotice = `Expired ${Math.abs(diffDays)} days ago`;
        }
      }

      const completionRate = taskStats.total > 0 ? `${Math.round((taskStats.completed / taskStats.total) * 100)}%` : '0%';

      // Combine client services
      let serviceList = [];
      if (Array.isArray(c.services)) {
        serviceList = c.services.map(s => typeof s === 'string' ? s : s?.name || '').filter(Boolean);
      }
      taskStats.services.forEach(s => {
        if (!serviceList.includes(s)) serviceList.push(s);
      });

      const row = worksheet.addRow([
        c.client || 'Unnamed Client',
        c.company || '-',
        c.email || '-',
        c.phone || c.mobile || '-',
        planName,
        subStatus.toUpperCase(),
        startDate,
        endDate,
        validityNotice,
        taskStats.total,
        taskStats.completed,
        taskStats.pending,
        completionRate,
        serviceList.join(', ') || 'General'
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        // Color Subscription Status
        if (colNumber === 6) {
          const val = String(cell.value || '').toUpperCase();
          if (val === 'ACTIVE') {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          } else if (val === 'EXPIRED') {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          }
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const filename = `Clients_Master_Report_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportClientsMasterReport] error:', error);
    return res.status(500).json({ success: false, message: 'Clients master report export failed', error: error.message });
  }
};

/**
 * 5. SPECIFIC CLIENT TASKS EXPORT
 */
exports.exportClientTasksReport = async (req, res) => {
  try {
    const clientId = req.params.clientId || req.query.clientId;
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const tasks = await ClientTask.find({ clientId })
      .populate('assigneeId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Client Tasks');

    let planName = 'Standard Plan';
    if (client.subscription && client.subscription.length > 0 && client.subscription[0].planName) {
      planName = client.subscription[0].planName;
    } else if (client.activeClientPlan) {
      try {
        const cp = await ClientPlan.findById(client.activeClientPlan).select('planName').lean();
        if (cp?.planName) planName = cp.planName;
      } catch {}
    }
    const activeServices = Array.isArray(client.services) && client.services.length > 0
      ? client.services.join(', ')
      : 'General Services';

    const subtitle = `Client: ${client.client} (${client.company}) | Plan: ${planName} | Services: ${activeServices} | Total Tasks: ${tasks.length} | Generated: ${formatDate(new Date())}`;
    applyHeaderStyling(worksheet, `CLIENT REPORT - ${client.client.toUpperCase()}`, subtitle);

    const headers = [
      'Task Name',
      'Description',
      'Service Name',
      'Plan Name',
      'Assigned To',
      'Priority',
      'Status',
      'Due Date',
      'Created Date'
    ];

    if (format === 'pdf') {
      const pdfRows = tasks.map((t) => {
        return [
          t.title || t.name || 'Untitled Task',
          t.description || '-',
          t.service || activeServices,
          t.planName || planName,
          t.assigneeId?.name || t.assignee || 'Unassigned',
          (t.priority || 'medium').toUpperCase(),
          (t.status || 'pending').toUpperCase(),
          formatDate(t.dueDate || t.dueDateTime),
          formatDate(t.createdAt)
        ];
      });
      if (pdfRows.length === 0) {
        pdfRows.push(['No specific tasks created yet', `Company: ${client.company}`, activeServices, planName, client.projectManager?.join(', ') || 'Unassigned', 'NORMAL', client.status || 'ACTIVE', '-', formatDate(client.createdAt)]);
      }
      const safeClient = (client.client || 'Client').replace(/[^a-zA-Z0-9_-]/g, '_');
      const pdfFilename = `Client_${safeClient}_Tasks_${new Date().toISOString().slice(0, 10)}.pdf`;
      return generatePdfTableReport(res, {
        title: `CLIENT REPORT - ${client.client.toUpperCase()}`,
        subtitle,
        headers,
        rows: pdfRows,
        filename: pdfFilename
      });
    }

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    if (tasks.length === 0) {
      const emptyRow = worksheet.addRow([
        'No specific tasks created yet',
        `Company: ${client.company}`,
        activeServices,
        planName,
        client.projectManager?.join(', ') || 'Unassigned',
        'NORMAL',
        client.status || 'ACTIVE',
        '-',
        formatDate(client.createdAt)
      ]);
      emptyRow.font = { name: 'Arial', size: 10, italic: true };
      emptyRow.height = 20;
    } else {
      tasks.forEach((t) => {
        const row = worksheet.addRow([
          t.title || t.name || 'Untitled Task',
          t.description || '-',
          t.service || activeServices,
          t.planName || planName,
          t.assigneeId?.name || t.assignee || 'Unassigned',
          (t.priority || 'medium').toUpperCase(),
          (t.status || 'pending').toUpperCase(),
          formatDate(t.dueDate || t.dueDateTime),
          formatDate(t.createdAt)
        ]);

        row.height = 20;
        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
          if (colNumber === 7) {
            const st = String(cell.value || '').toUpperCase();
            if (st.includes('COMPLETED')) {
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
            }
          }
        });
      });
    }

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const safeClient = (client.client || 'Client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Client_${safeClient}_Tasks_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportClientTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Client tasks export failed', error: error.message });
  }
};

/**
 * 6. PROJECTS MASTER REPORT EXPORT
 * Full metrics: Project Name, Status, Priority, Project Manager, Team Members,
 * Start Date, Due Date, Total Tasks, Completed Tasks, In Progress, Pending, Progress %
 */
exports.exportProjectsMasterReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const format = String(req.query.format || 'xlsx').toLowerCase();

    const filter = {
      $or: [
        { companyCode },
        { company: getEffectiveCompanyId(req) }
      ]
    };

    const projects = await Project.find(filter)
      .populate('managers', 'name email')
      .populate('users', 'name email employeeId')
      .sort({ createdAt: -1 })
      .lean();

    const headers = [
      'Project Name',
      'Status',
      'Priority',
      'Project Manager',
      'Members Count',
      'Team Members',
      'Start Date',
      'Due Date',
      'Total Tasks',
      'Completed Tasks',
      'In Progress',
      'Pending Tasks',
      'Progress %',
      'Created Date'
    ];

    const rows = projects.map(p => {
      const embeddedTasks = Array.isArray(p.tasks) ? p.tasks : [];
      const total = embeddedTasks.length;
      const completed = embeddedTasks.filter(t => ['completed', 'done', 'approved'].includes(String(t.status || '').toLowerCase())).length;
      const inProgress = embeddedTasks.filter(t => ['in progress', 'in-progress', 'active'].includes(String(t.status || '').toLowerCase())).length;
      const pending = Math.max(0, total - completed - inProgress);
      const pct = total > 0 ? Math.round((completed / total) * 100) + '%' : '0%';

      const membersList = Array.isArray(p.users) ? p.users.map(u => u.name || u.email).filter(Boolean).join(', ') : '-';
      const managerName = Array.isArray(p.managers) 
        ? p.managers.map(m => m.name).join(', ') 
        : (p.managers?.name || '-');

      return [
        p.projectName || p.name || 'Untitled Project',
        (p.status || 'planning').toUpperCase(),
        (p.priority || 'medium').toUpperCase(),
        managerName || '-',
        Array.isArray(p.users) ? p.users.length : 0,
        membersList || '-',
        formatDate(p.startDate),
        formatDate(p.endDate || p.dueDate),
        total,
        completed,
        inProgress,
        pending,
        pct,
        formatDate(p.createdAt)
      ];
    });

    const filename = `Projects_Master_Report_${new Date().toISOString().slice(0, 10)}`;
    const subtitle = `Company: ${companyCode || 'All'} | Total Projects: ${projects.length} | Generated: ${formatDate(new Date())}`;

    if (format === 'pdf') {
      const pdfRows = rows.map(r => r.map(c => (c !== null && c !== undefined ? String(c) : '-')));
      if (pdfRows.length === 0) {
        pdfRows.push(['No projects found for this company', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
      }
      return generatePdfTableReport(res, {
        title: 'CIIS NETWORK - PROJECTS MASTER REPORT',
        subtitle,
        headers,
        rows: pdfRows,
        filename: `${filename}.pdf`
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Projects Master');

    applyHeaderStyling(worksheet, 'CIIS NETWORK - PROJECTS MASTER REPORT', subtitle);

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    rows.forEach(r => {
      const row = worksheet.addRow(r);
      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        if (colNumber === 2) {
          const st = String(cell.value || '').toUpperCase();
          if (st === 'ACTIVE') cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          else if (st === 'COMPLETED') cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF2563EB' } };
          else if (st === 'PLANNING') cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD97706' } };
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 40);
      });
      column.width = maxLen;
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportProjectsMasterReport] error:', error);
    return res.status(500).json({ success: false, message: 'Projects master export failed', error: error.message });
  }
};
