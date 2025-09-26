
module.exports = (req, res, next) => {
  const allowedRoles = ['admin', 'manager'];

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'Access denied. Only admin or manager allowed.',
    });
  }

  next();
};
