const PagePermission = require('../../models/PagePermission');

const OVERDUE_STATUS_MESSAGE = 'Change the status of overdue tasks from Company All Task.';
const isOverdueStatus = status => String(status || '').trim().toLowerCase() === 'overdue';
const companyId = item => String(item?.company?._id || item?.company || item?.companyId || '');
const companyCode = item => String(item?.companyCode || item?.company?.companyCode || '').trim().toUpperCase();
const requestAuthorized = Symbol('companyAllTaskWrite');

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
  const user = req.user;
  const roles = [user?.companyRole, user?.role, user?.jobRole, user?.userType]
    .map(role => String(role || '').toLowerCase().replace(/[\s_-]+/g, ''));
  const privileged = user?.isSuperAdmin || user?.superAdmin || user?.isCompanyOwner ||
    roles.some(role => ['owner', 'companyowner', 'admin', 'companyadmin', 'superadmin'].includes(role));

  if (!privileged) {
    const id = companyId(user);
    const userId = String(user?._id || user?.id || '');
    if (!id || !userId) return res.status(403).json({ success: false, message: OVERDUE_STATUS_MESSAGE });
    try {
      const permission = await PagePermission.findOne({
        company: id,
        path: { $in: ['/ciisUser/company-all-task', '/ciisUser/company-all-task/tasks', 'company-all-task', 'company-all-task-tasks'] },
      }).lean();
      const editors = [
        ...(permission?.editUsers || []),
        ...(permission?.userAccessScopes || []).filter(scope => String(scope.accessType).toLowerCase() === 'edit'),
      ];
      if (!editors.some(entry => String(entry?.user?._id || entry?.user || '') === userId)) {
        return res.status(403).json({ success: false, message: OVERDUE_STATUS_MESSAGE });
      }
    } catch (error) {
      return next(error);
    }
  }

  req[requestAuthorized] = true;
  return next();
}

const isCompanyTaskWriteRequest = req => req[requestAuthorized] === true;

module.exports = { OVERDUE_STATUS_MESSAGE, isOverdueStatus, isCompanyTaskWrite, isCompanyTaskWriteRequest, authorizeCompanyTaskWrite };
