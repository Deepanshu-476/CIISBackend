const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { getAvailableTools, executeTool } = require('./tools');

/**
 * Creates an MCP Server instance scoped to a specific authenticated user session.
 * Enforces dynamic tool gating and permission validation.
 */
function createMcpServer(authContext) {
  const companyCode = String(authContext.companyCode || 'DEFAULT').toUpperCase();
  const role = String(authContext.permissions?.role || 'user').toLowerCase();
  const userName = authContext.user?.name || authContext.user?.email || 'User';

  const server = new Server(
    {
      name: `ciis-${companyCode.toLowerCase()}-${role}`,
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: `You are connected to the CIIS Network MCP Server for company '${companyCode}' authenticated as '${userName}' (Role: ${role}).
This server is 100% compatible with both Text Chat AND Claude Voice Mode / Live Voice Calls.
Rules for task operations:
1. Always present the CIIS Task Preview Card first with the 3 options (1. Create / Confirm, 2. Edit, 3. Cancel).
2. Never create or assign a task in the database without user confirmation unless they explicitly said 'create immediately'.
3. For screenshots and attachments during voice calls, set hasAttachment: true or pass attachmentPaths: ['latest_screenshot']. The local CIIS server automatically retrieves the latest screenshot or clipboard image from the desktop without needing file uploads.`
    }
  );

  // 1. Tool Listing: dynamically return only tools this user is allowed to access
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getAvailableTools(authContext);
    return {
      tools
    };
  });

  // 2. Tool Invocation: execute tool with double-layer permission guard
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    console.error(`[MCP CALL] ${name} called with args:`, JSON.stringify(args));
    try {
      const result = await executeTool(name, args, authContext);
      console.error(`[MCP SUCCESS] ${name}`);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`[MCP ERROR] ${name}:`, error.message);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${error.message}`
          }
        ]
      };
    }
  });

  return server;
}

module.exports = {
  createMcpServer
};
