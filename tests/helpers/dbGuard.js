/**
 * dbGuard.js - Safety guard for MongoDB tests and scripts.
 * 
 * FAILS CLOSED:
 * Refuses to allow tests/scripts to write to any database unless:
 * 1. Host is purely local (localhost, 127.0.0.1, ::1)
 * 2. OR, if remote, the database name strictly ends with '_test' or '_dev'.
 * 
 * If MONGO_URI is non-empty and cannot be parsed, or if the database name is empty, it THROWS.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function extractHostname(hostWithPort) {
  if (!hostWithPort) return '';
  const trimmed = hostWithPort.trim();
  // IPv6 bracketed format, e.g. [::1]:27017 or [::1]
  if (trimmed.startsWith('[')) {
    const closeBracket = trimmed.indexOf(']');
    if (closeBracket !== -1) {
      return trimmed.slice(1, closeBracket).toLowerCase();
    }
  }
  // Standard host:port or host
  const colonIndex = trimmed.indexOf(':');
  const host = colonIndex !== -1 ? trimmed.slice(0, colonIndex) : trimmed;
  return host.toLowerCase();
}

/**
 * Parses and verifies a MongoDB connection URI.
 * @param {string} [uri] Connection URI (defaults to process.env.MONGO_URI)
 * @returns {{ dbName: string, hosts: string[], isRemote: boolean, safe: boolean }}
 * @throws {Error} If URI is invalid, unparsable, has no database name, or targets unsafe remote DB
 */
function assertSafeTestDb(uri) {
  const targetUri = uri !== undefined ? uri : process.env.MONGO_URI;

  if (!targetUri || typeof targetUri !== 'string' || targetUri.trim() === '') {
    throw new Error('dbGuard: MONGO_URI is empty or undefined');
  }

  const raw = targetUri.trim();

  // Validate scheme: must start with mongodb:// or mongodb+srv://
  const schemeMatch = raw.match(/^(mongodb(?:\+srv)?):\/\/(.*)$/i);
  if (!schemeMatch) {
    throw new Error(`dbGuard: Invalid MongoDB URI scheme. Must start with mongodb:// or mongodb+srv://`);
  }

  const afterScheme = schemeMatch[2];

  // Strip credentials if present (everything before the last '@' before the first '/')
  let afterAuth = afterScheme;
  const firstSlash = afterScheme.indexOf('/');
  const atIndex = afterScheme.lastIndexOf('@', firstSlash !== -1 ? firstSlash : afterScheme.length);
  if (atIndex !== -1) {
    afterAuth = afterScheme.slice(atIndex + 1);
  }

  // Regex on raw string to extract host list and path segment before '?'
  // Format: <hosts>[/<database>][?<query>]
  const pathMatch = afterAuth.match(/^([^/?#]+)(?:\/([^?#]*))?(?:\?.*)?$/);
  if (!pathMatch) {
    throw new Error(`dbGuard: Failed to parse host and database path from URI`);
  }

  const hostListStr = pathMatch[1];
  const dbName = pathMatch[2];

  if (!dbName || dbName.trim() === '') {
    throw new Error(`dbGuard: Database name is empty in URI. Refusing connection.`);
  }

  const cleanDbName = dbName.trim();

  // Extract hosts by splitting host list on commas
  const rawHosts = hostListStr.split(',').map(h => h.trim()).filter(Boolean);
  if (rawHosts.length === 0) {
    throw new Error(`dbGuard: No hosts found in URI`);
  }

  const parsedHosts = [];
  let isRemote = false;

  for (const h of rawHosts) {
    const hostname = extractHostname(h);
    if (!hostname) {
      throw new Error(`dbGuard: Invalid host entry in URI`);
    }
    parsedHosts.push(hostname);
    if (!LOCAL_HOSTS.has(hostname)) {
      isRemote = true;
    }
  }

  if (isRemote) {
    const isSafeName = cleanDbName.endsWith('_test') || cleanDbName.endsWith('_dev');
    if (!isSafeName) {
      throw new Error(
        `dbGuard: UNSAFE CONNECTION REFUSED! Remote host(s) [${parsedHosts.join(', ')}] detected with non-test/dev database "${cleanDbName}". Remote database name must end with "_test" or "_dev".`
      );
    }
  }

  return {
    dbName: cleanDbName,
    hosts: parsedHosts,
    isRemote,
    safe: true
  };
}

module.exports = {
  assertSafeTestDb,
  extractHostname
};
