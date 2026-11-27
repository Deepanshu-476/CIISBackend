const { requirePageAccess } = require('./pageAccess');

const requireAnyPayrollPagePermission = (paths, action = 'view') =>
  requirePageAccess({ paths, action, label: 'this payroll page' });
const requirePayrollPagePermission = (path, action = 'view') =>
  requireAnyPayrollPagePermission([path], action);

module.exports = { requirePayrollPagePermission, requireAnyPayrollPagePermission };
