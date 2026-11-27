const PagePermission = require('../models/PagePermission');
const { hasGrantedPageAction, isClientLogin, isCompanyOwner } = require('../middleware/pageAccess');
const { getCompanyPageEntitlements, isPageEntitled } = require('./companyPageEntitlements');

const REGISTER_REQUEST_PATH = '/ciisUser/register-request';
const noAccess = { canView: false, canVerify: false };

const getRegisterRequestAccess = async user => {
  if (!user || isClientLogin(user)) return noAccess;
  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return noAccess;
  if (!isPageEntitled(await getCompanyPageEntitlements(companyId), { path: REGISTER_REQUEST_PATH })) return noAccess;
  if (isCompanyOwner(user)) return { canView: true, canVerify: true };

  const page = await PagePermission.findOne({ company: companyId, path: REGISTER_REQUEST_PATH }).lean();
  return {
    canView: hasGrantedPageAction(page, userId, 'view'),
    canVerify: hasGrantedPageAction(page, userId, 'approve')
  };
};

module.exports = { REGISTER_REQUEST_PATH, getRegisterRequestAccess };
