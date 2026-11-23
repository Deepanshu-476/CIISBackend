const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
const ApiKey = require('../models/ApiKey');

async function main() {
  const email = process.argv[2];
  const name = process.argv[3] || 'ChatGPT MCP Key';

  if (!email) {
    console.log(`
Usage:
  node CIISBackend/scripts/generateMcpApiKey.js <user_email> [key_name]

Example:
  node CIISBackend/scripts/generateMcpApiKey.js admin@ciis.com "ChatGPT Production Key"
    `);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);

    const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
    if (!user) {
      console.error(`❌ User not found with email: ${email}`);
      process.exit(1);
    }

    let companyCode = user.companyCode;
    let companyId = user.company;

    if (!companyCode && companyId) {
      const comp = await Company.findById(companyId).lean();
      if (comp) companyCode = comp.companyCode || comp.code;
    }

    if (!companyCode) {
      companyCode = 'TECH334753'; // default fallback company code
    }

    const { fullKey, keyPrefix, keyHash } = ApiKey.generateKey();
    const role = String(user.companyRole || user.role || 'employee').toLowerCase();

    const newKey = await ApiKey.create({
      name,
      user: user._id,
      company: companyId || user._id,
      companyCode: String(companyCode).toUpperCase(),
      role,
      allowedPages: user.allowedPages || user.pageManagement || [],
      keyHash,
      keyPrefix,
      isActive: true
    });

    console.log(`\n============================================================`);
    console.log(`✅ CIIS MCP SECURE API KEY GENERATED SUCCESSFULLY!`);
    console.log(`============================================================`);
    console.log(`User:         ${user.name || user.email} (${user.email})`);
    console.log(`Role:         ${role}`);
    console.log(`Company Code: ${companyCode}`);
    console.log(`Key Name:     ${name}`);
    console.log(`Key Prefix:   ${keyPrefix}...`);
    console.log(`------------------------------------------------------------`);
    console.log(`🔑 SECURE TOKEN (Copy now, will not be shown again):`);
    console.log(`\n${fullKey}\n`);
    console.log(`------------------------------------------------------------`);
    console.log(`💡 Usage in Claude Desktop / Cursor (claude_desktop_config.json):`);
    console.log(JSON.stringify({
      mcpServers: {
        "ciis-network": {
          command: "node",
          args: [path.resolve(__dirname, '../mcp/stdio.js')],
          env: { CIIS_API_KEY: fullKey }
        }
      }
    }, null, 2));
    console.log(`\n💡 Usage in ChatGPT / Custom GPT Action:`);
    console.log(`Authentication Type: API Key (Bearer)`);
    console.log(`Token Value:         ${fullKey}`);
    console.log(`Server SSE URL:      https://<your-ciis-domain>/api/mcp/sse`);
    console.log(`============================================================\n`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(`❌ Error generating key:`, err);
    process.exit(1);
  }
}

main();
