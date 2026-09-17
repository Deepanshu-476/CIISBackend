const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const multer = require("multer");
const { protect, restrictTo, isSuperAdminUser } = require("../middleware/authMiddleware");

// Scoping helpers
const requireCompanyMember = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
  if (isSuperAdminUser(req.user)) {
    return next();
  }
  const targetCompanyId = String(req.params.id || req.params.companyId || "");
  const userCompanyId = String(req.user.company?._id || req.user.company || req.user.companyId || "");

  if (targetCompanyId && userCompanyId && targetCompanyId === userCompanyId) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Access denied. You can only view your own company details.",
  });
};

const requireCompanyAdminOrSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
  if (isSuperAdminUser(req.user)) {
    return next();
  }
  const targetCompanyId = String(req.params.id || req.params.companyId || "");
  const userCompanyId = String(req.user.company?._id || req.user.company || req.user.companyId || "");
  
  const roles = [req.user.companyRole, req.user.jobRole, req.user.role]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase());
  const isOwnerOrAdmin = roles.some(r => ["owner", "admin", "company_owner", "companyowner", "company_admin"].includes(r));

  if (targetCompanyId && userCompanyId && targetCompanyId === userCompanyId && isOwnerOrAdmin) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Access denied. Only Platform SuperAdmin or Company Owner/Admin can perform this action.",
  });
};

// Allows unauthenticated public sign-up for prospective clients via /RegisterCompany,
// but if called with authentication, strictly restricts company creation to Platform SuperAdmin.
const canCreateCompany = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return protect(req, res, () => {
      if (!isSuperAdminUser(req.user)) {
        return res.status(403).json({
          success: false,
          message: "Access denied. Only Platform SuperAdmin can create companies when logged in.",
        });
      }
      next();
    });
  }
  next();
};

// Logo upload handler (supports public signup as well as authenticated admin updates)
router.post("/upload-logo", 
  (req, res, next) => {
    companyController.uploadLogo(req, res, (err) => {
      if (err) {
        let errMsg = err.message || 'Logo upload failed';
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          errMsg = 'Logo file size is too large. Max limit is 2MB.';
        }
        return res.status(400).json({
          success: false,
          message: errMsg
        });
      }
      next();
    });
  },
  companyController.uploadLogoHandler     
);

router.patch("/:id/logo", protect, requireCompanyAdminOrSuperAdmin, companyController.updateCompanyLogo);

// Company creation: Public self-registration allowed for guests; authenticated calls restricted to SuperAdmin
router.post("/", canCreateCompany, companyController.createCompany);

// SuperAdmin only endpoints
router.get("/", protect, restrictTo("super_admin"), companyController.getAllCompanies);

// Public lookup endpoints (needed by login, self-registration, and domain resolution)
router.get("/code/:companyCode", companyController.getCompanyByCode);
router.get("/details/:identifier", companyController.getCompanyDetailsByIdentifier);
router.get("/validate-url/:identifier", companyController.validateCompanyUrl);
router.get("/self-registration/:companyCode", companyController.getSelfRegistrationConfig);

// Company overview (authenticated)
router.get("/overview/current", protect, companyController.getCompanyOverview);
router.get("/:id/overview", protect, requireCompanyAdminOrSuperAdmin, companyController.getCompanyOverview);

// Company statistics and users (Company Admin or SuperAdmin)
router.get("/:id/stats", protect, requireCompanyAdminOrSuperAdmin, companyController.getCompanyStats);
router.get("/:id/users", protect, requireCompanyAdminOrSuperAdmin, companyController.getCompanyUsers);

// SuperAdmin platform control
router.patch("/:id/access", protect, restrictTo("super_admin"), companyController.updateCompanyAccess);
router.patch("/:id/subscription", protect, restrictTo("super_admin"), companyController.renewCompanySubscription);
router.patch("/:id/deactivate", protect, restrictTo("super_admin"), companyController.deactivateCompany);
router.patch("/:id/activate", protect, restrictTo("super_admin"), companyController.activateCompany);
router.delete("/:id", protect, restrictTo("super_admin"), companyController.deleteCompanyPermanently);

router.get('/test', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  res.json({  
    status: 'healthy',
    service: 'Company API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Company profile view and update
router.get("/:id", protect, requireCompanyMember, companyController.getCompanyById);
router.put("/:id", protect, requireCompanyAdminOrSuperAdmin, companyController.updateCompany);

// Dashboard config and location settings
router.get("/:id/dashboard-config", protect, companyController.getDashboardConfig);
router.put("/:id/dashboard-config", protect, companyController.updateDashboardConfig);
router.get("/:id/location", protect, companyController.getCompanyLocation);
router.put("/:id/location", protect, companyController.updateCompanyLocation);

router.get('/test', (req, res) => {
  res.json({  
    status: 'healthy',
    service: 'Menu Access API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

module.exports = router;
