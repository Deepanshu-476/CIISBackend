// Redirect console.log to console.error so stdout remains clean for MCP JSON-RPC protocol
console.log = (...args) => console.error(...args);
process.env.DOTENV_CONFIG_QUIET = 'true';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const mongoose = require('mongoose');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { authenticateMcpKey } = require('./auth');
const { createMcpServer } = require('./createMcpServer');

async function runStdio() {
  const apiKey = process.env.CIIS_API_KEY || process.argv[2];
  if (!apiKey) {
    console.error('Error: Missing CIIS_API_KEY environment variable or argument.');
    process.exit(1);
  }

  // Connect to DB if not connected
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }

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
