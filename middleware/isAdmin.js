module.exports = (req, res, next) => {
  if (req.user.role === 'user') {
    return res.status(403).json({ error: 'Access denied. Only admins or HR allowed.' });
  }
  next();
};
