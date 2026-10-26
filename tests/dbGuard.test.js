const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDb, extractHostname } = require('./helpers/dbGuard.js');

test('dbGuard - extractHostname helper', () => {
  assert.equal(extractHostname('localhost:27017'), 'localhost');
  assert.equal(extractHostname('127.0.0.1:27017'), '127.0.0.1');
  assert.equal(extractHostname('[::1]:27017'), '::1');
  assert.equal(extractHostname('atlas-shard-00-01.huybyk4.mongodb.net:27017'), 'atlas-shard-00-01.huybyk4.mongodb.net');
});

test('dbGuard - localhost URI with any db name is allowed', () => {
  const result = assertSafeTestDb('mongodb://localhost:27017/ciisss');
  assert.equal(result.isRemote, false);
  assert.equal(result.dbName, 'ciisss');
  assert.deepEqual(result.hosts, ['localhost']);

  const ipv4Result = assertSafeTestDb('mongodb://127.0.0.1:27017/ciisss');
  assert.equal(ipv4Result.isRemote, false);

  const ipv6Result = assertSafeTestDb('mongodb://[::1]:27017/ciisss');
  assert.equal(ipv6Result.isRemote, false);
});

test('dbGuard - real URI shape (multi-host mongodb:// with comma-separated hosts) throws on non-test/dev db', () => {
  const fakeClusterUri = 'mongodb://fakeuser:fakepass123@ac-fake-shard-00-00.fake.mongodb.net:27017,ac-fake-shard-00-01.fake.mongodb.net:27017,ac-fake-shard-00-02.fake.mongodb.net:27017/ciisss?ssl=true&replicaSet=atlas-fake-shard-0&authSource=admin&retryWrites=true&w=majority';
  
  assert.throws(() => {
    assertSafeTestDb(fakeClusterUri);
  }, /UNSAFE CONNECTION REFUSED! Remote host\(s\).*with non-test\/dev database "ciisss"/);
});

test('dbGuard - mongodb+srv URI on remote host throws on non-test/dev db', () => {
  const srvUri = 'mongodb+srv://admin:pass123@cluster0.abcde.mongodb.net/production_db?retryWrites=true&w=majority';
  assert.throws(() => {
    assertSafeTestDb(srvUri);
  }, /UNSAFE CONNECTION REFUSED! Remote host\(s\).*with non-test\/dev database "production_db"/);
});

test('dbGuard - remote multi-host URI succeeds when database ends with _test or _dev', () => {
  const testDbUri = 'mongodb://fakeuser:fakepass123@ac-fake-shard-00-00.fake.mongodb.net:27017,ac-fake-shard-00-01.fake.mongodb.net:27017/ciis_test?ssl=true';
  const testRes = assertSafeTestDb(testDbUri);
  assert.equal(testRes.isRemote, true);
  assert.equal(testRes.dbName, 'ciis_test');

  const devDbUri = 'mongodb+srv://admin:pass123@cluster0.abcde.mongodb.net/ciis_dev?retryWrites=true';
  const devRes = assertSafeTestDb(devDbUri);
  assert.equal(devRes.isRemote, true);
  assert.equal(devRes.dbName, 'ciis_dev');
});

test('dbGuard - unparsable strings throw (fail closed)', () => {
  assert.throws(() => assertSafeTestDb('not-a-mongo-uri'), /Invalid MongoDB URI scheme/);
  assert.throws(() => assertSafeTestDb('http://localhost:27017/ciis_test'), /Invalid MongoDB URI scheme/);
  assert.throws(() => assertSafeTestDb(''), /MONGO_URI is empty/);
});

test('dbGuard - empty database name throws', () => {
  assert.throws(() => assertSafeTestDb('mongodb://localhost:27017/'), /Database name is empty/);
  assert.throws(() => assertSafeTestDb('mongodb://localhost:27017'), /Database name is empty/);
  assert.throws(() => assertSafeTestDb('mongodb://fake-remote.com:27017/?replicaSet=rs0'), /Database name is empty/);
});
