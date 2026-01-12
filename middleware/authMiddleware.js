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

    const userId =
      decoded._id ||
      decoded.id ||
      decoded.userId ||
      (decoded.user && decoded.user._id) ||
      (decoded.user && decoded.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token structure",
      });
    }

    req.user = {
      ...decoded,
      _id: userId.toString(),
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = auth;
