const express = require("express");
const router = express.Router();
const alertController = require("../controllers/alertController");

const { protect, authorize } = require('../../middleware/authMiddleware');


const canManageAlerts = (req, res, next) => {
  const normalize = r => String(r || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const allowed = [
    'admin',
    'hr',
    'manager',
    'owner',
    'company_admin',
    'companyadmin',
    'company_owner',
    'companyowner',
    'superadmin',
    'super_admin',
  ];
  const role = normalize(req.user?.role);
  const companyRole = normalize(req.user?.companyRole);
  const jobRole = normalize(req.user?.jobRoleName || req.user?.jobRole);

  if (allowed.includes(role) || allowed.includes(companyRole) || allowed.includes(jobRole)) {
    return next();
  }
  // Employees given the Create Alert page in Page Management may manage alerts too.
  const action = req.method === 'DELETE' ? 'delete' : 'edit';
  return require('../../middleware/pageAccess')
    .hasPageAccess(req.user, { paths: ['/ciisUser/create-alert', 'create-alert'], action })
    .then(ok => (ok ? next() : res.status(403).json({ success: false, message: 'Not authorized to manage alerts' })))
    .catch(next);
};


router.get("/", protect, alertController.getAlerts);
router.get("/unread/count", protect, alertController.getUnreadCount);
router.patch("/mark-all/read", protect, alertController.markAllAsRead);
router.patch("/:id/read", protect, alertController.markAsRead);
router.patch("/:id/unread", protect, alertController.markAsUnread);


router.post("/", protect, canManageAlerts, alertController.addAlert);
router.put("/:id", protect, canManageAlerts, alertController.updateAlert);
router.delete("/:id", protect, canManageAlerts, alertController.deleteAlert);


module.exports = router;

