const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateLoginOtpRecord,
  MAX_OTP_ATTEMPTS,
} = require("../middleware/loginOtpGuard");

test("accepts only the exact OTP stored for the login session", () => {
  const record = {
    otp: "123456",
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  };

  assert.equal(evaluateLoginOtpRecord(record, "123456").ok, true);

  const bypassAttempt = evaluateLoginOtpRecord(record, "987654");
  assert.equal(bypassAttempt.ok, false);
  assert.equal(bypassAttempt.code, "INVALID_OTP");
  assert.equal(bypassAttempt.incrementAttempt, true);
});

test("rejects an expired OTP before accepting its value", () => {
  const record = {
    otp: "123456",
    attempts: 0,
    expiresAt: new Date(Date.now() - 1_000),
  };

  const result = evaluateLoginOtpRecord(record, "123456");
  assert.equal(result.ok, false);
  assert.equal(result.code, "OTP_EXPIRED");
  assert.equal(result.deleteRecord, true);
});

test("locks the session after the final invalid OTP attempt", () => {
  const record = {
    otp: "123456",
    attempts: MAX_OTP_ATTEMPTS - 1,
    expiresAt: new Date(Date.now() + 60_000),
  };

  const result = evaluateLoginOtpRecord(record, "000000");
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.code, "OTP_ATTEMPTS_EXCEEDED");
  assert.equal(result.incrementAttempt, true);
  assert.equal(result.deleteRecord, true);
});

test("rejects a session already over the OTP attempt limit", () => {
  const record = {
    otp: "123456",
    attempts: MAX_OTP_ATTEMPTS,
    expiresAt: new Date(Date.now() + 60_000),
  };

  const result = evaluateLoginOtpRecord(record, "123456");
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.code, "OTP_ATTEMPTS_EXCEEDED");
});
