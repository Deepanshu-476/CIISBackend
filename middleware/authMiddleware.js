const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization token missing or malformed",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      ...decoded,
      _id: decoded.id || decoded._id,
    };

    next();
  } catch (err) {
    console.error("❌ JWT verification failed:", err.message);

    const isExpired = err.name === "TokenExpiredError";

    return res.status(401).json({
      success: false,
      message: isExpired
        ? "Token expired. Please login again."
        : "Invalid token. Please login again.",
    });
  }
};

module.exports = auth;
