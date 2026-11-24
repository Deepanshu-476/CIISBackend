const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { getAvailableTools, executeTool } = require('./tools');

/**
 * Creates an MCP Server instance scoped to a specific authenticated user session.
 * Enforces dynamic tool gating and permission validation.
 */
function createMcpServer(authContext) {
  const server = new Server(
    {
      name: 'ciis-network',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
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
