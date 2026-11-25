// Redirect console.log to console.error so stdout remains clean for MCP JSON-RPC protocol
console.log = (...args) => console.error(...args);
process.env.DOTENV_CONFIG_QUIET = 'true';

// Prevent unhandled errors from terminating the stdio server process abruptly
process.on('uncaughtException', (err) => {
  console.error('[CIIS MCP UncaughtException]', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CIIS MCP UnhandledRejection]', reason?.message || reason);
});

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const mongoose = require('mongoose');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { authenticateMcpKey } = require('./auth');
const { createMcpServer } = require('./createMcpServer');

/**
 * Connects to MongoDB with retry logic and error listeners
 */
async function connectToMongo(retries = 5, delay = 2000) {
  if (mongoose.connection.readyState === 1) return;

  mongoose.connection.on('disconnected', () => {
    console.error('[CIIS MCP DB] MongoDB disconnected. Attempting reconnect...');
  });
  mongoose.connection.on('error', (err) => {
    console.error('[CIIS MCP DB Error]', err.message);
  });
  mongoose.connection.on('reconnected', () => {
    console.error('[CIIS MCP DB] MongoDB reconnected successfully.');
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (mongoose.connection.readyState === 1) return;
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000
      });
      return;
    } catch (err) {
      console.error(`[CIIS MCP DB Connect Attempt ${attempt}/${retries} failed]`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function runStdio() {
  const apiKey = process.env.CIIS_API_KEY || process.argv[2];
  if (!apiKey) {
    console.error('Error: Missing CIIS_API_KEY environment variable or argument.');
    process.exit(1);
  }

  // Connect to DB with retries
  await connectToMongo();

  const authContext = await authenticateMcpKey(apiKey);
  const server = createMcpServer(authContext);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`[CIIS MCP] Stdio server connected for ${authContext.user.name} (${authContext.companyCode}, role: ${authContext.permissions.role})`);
}

runStdio().catch(err => {
  console.error('[CIIS MCP Fatal]', err);
  process.exit(1);
});
