const { hasPageAccess } = require('../../middleware/pageAccess');

const OVERDUE_STATUS_MESSAGE = 'Change the status of overdue tasks from Company All Task.';
const isOverdueStatus = status => String(status || '').trim().toLowerCase() === 'overdue';
const companyId = item => String(item?.company?._id || item?.company || item?.companyId || '');
const companyCode = item => String(item?.companyCode || item?.company?.companyCode || '').trim().toUpperCase();
const requestAuthorized = Symbol('companyAllTaskWrite');
const COMPANY_TASK_PAGES = ['/ciisUser/company-all-task', '/ciisUser/company-all-task/tasks', 'company-all-task', 'company-all-task-tasks'];
const hasCompanyTaskWriteGrant = req => hasPageAccess(req.user, {
  paths: COMPANY_TASK_PAGES, action: req.method === 'DELETE' ? 'delete' : 'edit',
});

function isCompanyTaskWrite(req, record) {
  if (!req[requestAuthorized] || !record) return false;
  const requesterId = companyId(req.user);
  const recordId = companyId(record);
  if (requesterId && recordId) return requesterId === recordId;
  const requesterCode = companyCode(req.user);
  const recordCode = companyCode(record);
  return Boolean(requesterCode && recordCode && requesterCode === recordCode);
}

async function authorizeCompanyTaskWrite(req, res, next) {
  try {
    if (!(await hasCompanyTaskWriteGrant(req))) {
      return res.status(403).json({ success: false, message: 'Company task permission is required from Page Management.' });
    }
  } catch (error) {
    return next(error);
  }

  req[requestAuthorized] = true;
  return next();
}

const isCompanyTaskWriteRequest = req => req[requestAuthorized] === true;

module.exports = { OVERDUE_STATUS_MESSAGE, isOverdueStatus, isCompanyTaskWrite, isCompanyTaskWriteRequest, authorizeCompanyTaskWrite, hasCompanyTaskWriteGrant };
