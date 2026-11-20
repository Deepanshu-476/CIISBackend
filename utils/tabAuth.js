const usesTabAuth = req => req?.get?.('X-CIIS-Auth-Mode') === 'tab';

const scopeTabAuth = (req, res, next) => {
  if (usesTabAuth(req)) {
    // Browser cookies are shared across tabs, including when an older web session
    // is still open. Requests in tab mode must authenticate with their own token.
    if (req.cookies) {
      for (const name of ['auth_token', 'access_token', 'refresh_token', 'token']) {
        delete req.cookies[name];
      }
    }
    res.set('Cache-Control', 'private, no-store');
  }
  next();
};

module.exports = { usesTabAuth, scopeTabAuth };
