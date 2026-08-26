const mongoose = require("mongoose");
const PagePermission = require("../models/PagePermission");

const companyId = req => req.user?.company?._id || req.user?.company || req.user?.companyId;
const normalizeRole = value => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const administrativeRoles = new Set(["owner", "admin", "hr", "super_admin", "superadmin", "company_owner", "companyowner"]);
const ids = (page, key) => (page?.[key] || []).map(item => String(item?.user?._id || item?.user || "")).filter(Boolean);

const hasAdministrativeAccess = user => [user?.companyRole, user?.role, user?.jobRole]
  .map(normalizeRole)
  .some(role => administrativeRoles.has(role));

const requirePayrollPagePermission = (path, permission = "view") => async (req, res, next) => {
  try {
    if (hasAdministrativeAccess(req.user)) return next();
    const company = companyId(req);
    const userId = String(req.user?._id || req.user?.id || "");
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(userId)) {
      return res.status(403).json({ success: false, message: "A valid company payroll user is required." });
    }
    const page = await PagePermission.findOne({ company, path }).lean();
    if (!page) return res.status(403).json({ success: false, message: "Payroll page access has not been assigned in Page Management." });

    const viewIds = new Set([...ids(page, "viewUsers"), ...ids(page, "editUsers"), ...ids(page, "deleteUsers"), ...ids(page, "approvers")]);
    const allowed = permission === "view"
      ? viewIds.has(userId)
      : permission === "delete"
        ? ids(page, "deleteUsers").includes(userId)
        : ids(page, "editUsers").includes(userId);
    if (!allowed) return res.status(403).json({ success: false, message: `You do not have ${permission} access for this payroll page.` });
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireAnyPayrollPagePermission = (paths, permission = "view") => async (req, res, next) => {
  try {
    if (hasAdministrativeAccess(req.user)) return next();
    const company = companyId(req);
    const userId = String(req.user?._id || req.user?.id || "");
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(userId)) {
      return res.status(403).json({ success: false, message: "A valid company payroll user is required." });
    }
    const pages = await PagePermission.find({ company, path: { $in: paths } }).lean();
    const allowed = pages.some(page => {
      if (permission === "view") return [...ids(page, "viewUsers"), ...ids(page, "editUsers"), ...ids(page, "deleteUsers"), ...ids(page, "approvers")].includes(userId);
      if (permission === "delete") return ids(page, "deleteUsers").includes(userId);
      return ids(page, "editUsers").includes(userId);
    });
    if (!allowed) return res.status(403).json({ success: false, message: `You do not have ${permission} access for this payroll page.` });
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { requirePayrollPagePermission, requireAnyPayrollPagePermission };
