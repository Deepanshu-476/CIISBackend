const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check if Bearer token exists
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization token missing or malformed",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // UNIVERSAL USER ID EXTRACTION (works for all types of JWT payloads)
    const userId =
      decoded._id ||
      decoded.id ||
      decoded.userId ||
      (decoded.user && decoded.user._id) ||
      (decoded.user && decoded.user.id);

    if (!userId) {
      console.error("❌ JWT decoded but NO userId found:", decoded);
      return res.status(401).json({
        success: false,
        message: "Invalid token structure. User not found.",
      });
    }

    // Assign safe user object
    req.user = {
      ...decoded,
      _id: userId.toString(),
    };

    next();
  } catch (err) {
    console.error("❌ JWT verification failed:", err.message);

    return res.status(401).json({
      success: false,
      message:
        err.name === "TokenExpiredError"
          ? "Token expired. Please login again."
          : "Invalid token. Please login again.",
    });
  }
};

module.exports = auth;
