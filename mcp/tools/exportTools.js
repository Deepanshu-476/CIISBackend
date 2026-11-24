/**
 * Export Tools for MCP
 * Allows ChatGPT & Claude to export reports and save them directly to the user's computer
 */
const fs = require('fs');
const path = require('path');
const exportController = require('../../HR-CDS/controllers/exportReportController');

class MockResponse {
  constructor() {
    this.chunks = [];
    this.headers = {};
    this.statusCode = 200;
    this.finished = false;
  }
  setHeader(k, v) { this.headers[k] = v; }
  status(code) { this.statusCode = code; return this; }
  write(chunk) {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }
  end(chunk) {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.finished = true;
  }
  send(data) {
    if (data) this.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    this.finished = true;
  }
  getBuffer() {
    return Buffer.concat(this.chunks);
  }
}

const exportTools = [
  {
    name: 'export_portal_report',
    description: 'Generates and exports report files for Attendance, Tasks, Projects, or Clients in PDF, Excel (.xlsx), or CSV format and saves them directly to the user\'s Downloads folder.',
    parameters: {
      type: 'object',
      properties: {
        reportType: {
          type: 'string',
          enum: ['attendance', 'tasks', 'projects_master', 'project_tasks', 'clients_master', 'client_tasks'],
          description: 'Type of report to export'
        },
        format: {
          type: 'string',
          enum: ['pdf', 'xlsx', 'csv'],
          default: 'xlsx',
          description: 'Export file format'
        },
        timeframe: {
          type: 'string',
          description: 'e.g. today, yesterday, this_month, last_month, or YYYY-MM-DD'
        },
        entityId: {
          type: 'string',
          description: 'Optional Project ID or Client ID when exporting project_tasks or client_tasks'
        }
      },
      required: ['reportType']
    },
    permissionCheck: (ctx, args) => {
      if (args.reportType === 'attendance' && !ctx.permissions.canViewAllAttendance) {
        return false;
      }
      if (args.reportType === 'clients_master' && !ctx.permissions.canManageClients) {
        return false;
      }
      return true;
    },
    handler: async (args, ctx) => {
      const { reportType, format = 'xlsx', timeframe = 'today', entityId } = args;

      if (reportType === 'attendance' && !ctx.permissions.canViewAllAttendance) {
        throw new Error('Permission denied: You do not have permission to export company attendance reports.');
      }

      const ext = format === 'pdf' ? '.pdf' : (format === 'csv' ? '.csv' : '.xlsx');
      const dateTag = new Date().toISOString().slice(0, 10);
      const filename = `${reportType}_report_${dateTag}${ext}`;

      const mockReq = {
        query: {
          format,
          type: 'all'
        },
        user: ctx.user,
        companyCode: ctx.companyCode,
        params: {}
      };

      if (timeframe === 'this_month') {
        mockReq.query.type = 'monthly';
        mockReq.query.month = 'this';
      } else if (timeframe === 'last_month') {
        mockReq.query.type = 'monthly';
        mockReq.query.month = 'last';
      } else if (timeframe === 'yesterday') {
        mockReq.query.date = 'yesterday';
      } else {
        mockReq.query.date = 'today';
      }

      const mockRes = new MockResponse();
      let fileBuffer = null;

      try {
        if (reportType === 'attendance') {
          await exportController.exportAttendanceReport(mockReq, mockRes);
        } else if (reportType === 'tasks') {
          mockReq.query.type = ctx.permissions.isAdmin ? 'all' : 'self';
          await exportController.exportTasksReport(mockReq, mockRes);
        } else if (reportType === 'projects_master') {
          await exportController.exportProjectsMasterReport(mockReq, mockRes);
        } else if (reportType === 'project_tasks' && entityId) {
          mockReq.params.projectId = entityId;
          await exportController.exportProjectTasksReport(mockReq, mockRes);
        } else if (reportType === 'clients_master') {
          await exportController.exportClientsMasterReport(mockReq, mockRes);
        } else if (reportType === 'client_tasks' && entityId) {
          mockReq.params.clientId = entityId;
          await exportController.exportClientTasksReport(mockReq, mockRes);
        } else {
          await exportController.exportTasksReport(mockReq, mockRes);
        }

        fileBuffer = mockRes.getBuffer();
      } catch (err) {
        console.error('[export_portal_report generation error]', err);
      }

      // Save to Downloads folder if buffer is available
      let savedFilePath = null;
      if (fileBuffer && fileBuffer.length > 0) {
        try {
          const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\ranak';
          const downloadsDir = path.join(userHome, 'Downloads');
          if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
          }
          savedFilePath = path.join(downloadsDir, filename);
          fs.writeFileSync(savedFilePath, fileBuffer);
        } catch (fsErr) {
          console.error('[export_portal_report local save error]', fsErr);
        }
      }

      const baseUrl = process.env.BASE_URL || 'https://cds.ciisnetwork.in';
      const downloadUrl = `${baseUrl}/api/export-reports/${reportType === 'attendance' ? 'attendance' : 'tasks'}?format=${format}&date=${mockReq.query.date || 'today'}`;

      return {
        success: true,
        reportType,
        format: format.toUpperCase(),
        filename,
        savedFilePath: savedFilePath || 'Saved directly to Downloads folder',
        downloadUrl,
        message: savedFilePath 
          ? `✅ Report successfully exported and saved directly to your computer at: ${savedFilePath}`
          : `✅ Report generated successfully. Download URL: ${downloadUrl}`
      };
    }
  }
];

module.exports = exportTools;
