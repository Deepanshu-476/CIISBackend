const jwt = require('jsonwebtoken');
const { readLoginOtp, writeState } = require('./data');
const { messageOf } = require('./http');

const tokenStillGood = (token) => {
  if (!token) return false;
  try {
    const decoded = jwt.decode(token);
    return decoded && decoded.exp && decoded.exp * 1000 > Date.now() + 15 * 60 * 1000;
  } catch {
    return false;
  }
};

// Same payload the backend puts in a login token. Used only when the real login
// cannot finish here (OTP email could not be sent, or the login rate limit hit),
// so the rest of the run can still test the other APIs.
const mintToken = (user, companyCode) => {
  if (!process.env.JWT_SECRET) return null;
  return jwt.sign({
    id: user.id,
    _id: user.id,
    userId: user.id,
    email: user.email,
    companyCode,
    role: user.companyRole || 'employee',
    jobRole: user.jobRoleId || user.companyRole || 'employee',
  }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

// Logs in through the real company-login API (handles the OTP step by reading the
// OTP the backend stored). Records a test row when `record` is set.
const login = async (ctx, key, { record = true, name } = {}) => {
  const { T, state } = ctx;
  const u = state.users[key];
  const label = name || `Login: ${key}`;
  const path = `/api/auth/company/${state.companyCode}/login`;
  const res = await T.call(label, 'POST', path, {
    body: { email: u.email, password: u.password },
    expect: '200 + token (or OTP step)',
    as: 'guest',
  }, r => {
    if (r.status === 200 && (r.data?.token || r.data?.requiresOTP)) return true;
    if (r.status === 429) return { warn: 'Login rate limit hit (20 per 15 min per IP). Using a fallback token for the rest of the run.' };
    if (r.status === 503 && r.data?.errorCode === 'EMAIL_NOT_SENT') return { warn: 'Login OTP is ON but the OTP email could not be sent. Using a fallback token.' };
    return `expected 200 with token, got ${r.status}: ${messageOf(r)}`;
  });

  if (res.status === 404 && res.data?.errorCode === 'COMPANY_NOT_FOUND') {
    throw new Error(`The backend does not see dummy company ${state.companyCode}. It is connected to a different database than the lab.`);
  }
  let token = res.data?.token || null;
  let refreshToken = res.data?.refreshToken || null;
  let loginUser = res.data?.user || null;

  if (res.status === 200 && res.data?.requiresOTP) {
    const otp = await readLoginOtp(u.email);
    const verify = await T.call(`${label} — verify OTP`, 'POST', `/api/auth/company/${state.companyCode}/verify-otp`, {
      body: { otp, tempToken: res.data.tempToken, email: u.email },
      expect: '200 + token',
      as: 'guest',
    }, r => (r.status === 200 && r.data?.token ? true : `OTP verify failed (${r.status}): ${messageOf(r)}`));
    token = verify.data?.token || null;
    refreshToken = verify.data?.refreshToken || refreshToken;
    loginUser = verify.data?.user || loginUser;
  }

  if (!token) {
    token = mintToken(u, state.companyCode);
    if (token && record) T.log(`${key}: using fallback token (real login did not return one)`, 'warn');
  }
  u.token = token;
  if (refreshToken) u.refreshToken = refreshToken;
  writeState(state);
  return { token, res, loginUser };
};

const tokenFor = async (ctx, key) => {
  const u = ctx.state.users[key];
  if (!u) throw new Error(`No dummy user "${key}"`);
  if (tokenStillGood(u.token)) return u.token;
  const { token } = await login(ctx, key, { name: `Login: ${key}` });
  return token;
};

module.exports = { login, tokenFor, mintToken, tokenStillGood };
