function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ err: "Forbidden" });
    }
    next();
  };
}

module.exports = requireRole;
