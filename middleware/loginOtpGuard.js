const mongoose = require("mongoose");

const MAX_OTP_ATTEMPTS = 3;

const evaluateLoginOtpRecord = (record, submittedOtp, now = new Date()) => {
  if (!record) {
    return { ok: false, status: 400, code: "INVALID_OTP", message: "Invalid OTP" };
  }

  if (record.expiresAt && new Date(record.expiresAt) < now) {
    return { ok: false, status: 400, code: "OTP_EXPIRED", message: "OTP has expired", deleteRecord: true };
  }

  const attempts = Number(record.attempts || 0);
  if (attempts >= MAX_OTP_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      code: "OTP_ATTEMPTS_EXCEEDED",
      message: "Too many failed attempts. Please login again.",
      deleteRecord: true,
    };
  }

  const normalizedSubmittedOtp = String(submittedOtp || "").trim();
  const storedOtp = String(record.otp || "");

  if (storedOtp !== normalizedSubmittedOtp) {
    const nextAttempts = attempts + 1;
    return {
      ok: false,
      status: nextAttempts >= MAX_OTP_ATTEMPTS ? 429 : 400,
      code: nextAttempts >= MAX_OTP_ATTEMPTS ? "OTP_ATTEMPTS_EXCEEDED" : "INVALID_OTP",
      message: nextAttempts >= MAX_OTP_ATTEMPTS
        ? "Too many failed attempts. Please login again."
        : "Invalid OTP",
      incrementAttempt: true,
      nextAttempts,
      deleteRecord: nextAttempts >= MAX_OTP_ATTEMPTS,
    };
  }

  return { ok: true };
};

const loginOtpGuard = async (req, res, next) => {
  try {
    const { email, otp, tempToken } = req.body || {};

    if (!email || !otp || !tempToken) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and tempToken are required",
        errorCode: "OTP_FIELDS_REQUIRED",
      });
    }

    const LoginOTP = mongoose.models.LoginOTP;
    if (!LoginOTP) {
      console.error("LoginOTP model is not registered before OTP guard execution");
      return res.status(500).json({
        success: false,
        message: "Authentication service is unavailable",
        errorCode: "AUTH_SERVICE_UNAVAILABLE",
      });
    }

    const record = await LoginOTP.findOne({
      email,
      tempToken,
      verified: false,
    });

    const decision = evaluateLoginOtpRecord(record, otp);
    if (decision.ok) return next();

    if (record && decision.incrementAttempt) {
      const updated = await LoginOTP.findOneAndUpdate(
        {
          _id: record._id,
          verified: false,
          attempts: { $lt: MAX_OTP_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        { new: true }
      );

      if (!updated || Number(updated.attempts || 0) >= MAX_OTP_ATTEMPTS) {
        await LoginOTP.deleteOne({ _id: record._id });
        return res.status(429).json({
          success: false,
          message: "Too many failed attempts. Please login again.",
          errorCode: "OTP_ATTEMPTS_EXCEEDED",
        });
      }
    } else if (record && decision.deleteRecord) {
      await LoginOTP.deleteOne({ _id: record._id });
    }

    return res.status(decision.status).json({
      success: false,
      message: decision.message,
      errorCode: decision.code,
    });
  } catch (error) {
    console.error("OTP guard error:", error);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      errorCode: "OTP_GUARD_ERROR",
    });
  }
};

module.exports = {
  loginOtpGuard,
  evaluateLoginOtpRecord,
  MAX_OTP_ATTEMPTS,
};
