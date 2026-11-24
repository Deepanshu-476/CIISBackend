/**
 * Export Tools for MCP
 * Allows ChatGPT to request file downloads for Attendance, Tasks, Projects, and Clients
 */
const exportTools = [
  {
    name: 'export_portal_report',
    description: 'Generates an export download link for Attendance, Tasks, Projects, or Clients in PDF, Excel (.xlsx), or CSV format.',
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

      let endpoint = '';
      const params = new URLSearchParams();
      params.append('format', format);

      if (reportType === 'attendance') {
        endpoint = '/api/export-reports/attendance';
        if (timeframe === 'this_month') {
          params.append('type', 'monthly');
          params.append('month', 'this');
        } else if (timeframe === 'last_month') {
          params.append('type', 'monthly');
          params.append('month', 'last');
        } else if (timeframe === 'yesterday') {
          params.append('date', 'yesterday');
        } else {
          params.append('date', 'today');
        }
        params.append('type', 'all');
      } else if (reportType === 'tasks') {
        endpoint = '/api/export-reports/tasks';
        params.append('type', ctx.permissions.isAdmin ? 'all' : 'self');
      } else if (reportType === 'projects_master') {
        endpoint = '/api/export-reports/projects-master';
      } else if (reportType === 'project_tasks' && entityId) {
        endpoint = `/api/export-reports/project-tasks/${entityId}`;
      } else if (reportType === 'clients_master') {
        endpoint = '/api/export-reports/clients-master';
      } else if (reportType === 'client_tasks' && entityId) {
        endpoint = `/api/export-reports/client-tasks/${entityId}`;
      } else {
        endpoint = '/api/export-reports/tasks';
      }

      const downloadUrl = `${endpoint}?${params.toString()}`;
      const ext = format === 'pdf' ? '.pdf' : (format === 'csv' ? '.csv' : '.xlsx');
      const filename = `${reportType}_report_${new Date().toISOString().slice(0, 10)}${ext}`;

      return {
        success: true,
        reportType,
        format,
        filename,
        downloadUrl,
        message: `Report for ${reportType} generated successfully in ${format.toUpperCase()} format. Download link: ${downloadUrl}`
      };
    }
  }
];

module.exports = exportTools;
