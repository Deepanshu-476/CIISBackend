const taskTools = require('./taskTools');
const clientTools = require('./clientTools');
const attendanceTools = require('./attendanceTools');
const performanceTools = require('./performanceTools');
const exportTools = require('./exportTools');
const menuTools = require('./menuTools');

const allTools = [
  ...menuTools,
  ...taskTools,
  ...clientTools,
  ...attendanceTools,
  ...performanceTools,
  ...exportTools
];

/**
 * Returns only tools allowed for the given user context (Dynamic Tool Gating)
 */
function getAvailableTools(ctx) {
  return allTools.filter(t => {
    try {
      if (typeof t.permissionCheck === 'function') {
        return t.permissionCheck(ctx, {});
      }
      return true;
    } catch {
      return false;
    }
  }).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters
  }));
}

/**
 * Executes a tool call with strict permission validation
 */
async function executeTool(toolName, args, ctx) {
  const tool = allTools.find(t => t.name === toolName);
  if (!tool) {
    throw new Error(`Tool '${toolName}' does not exist on CIIS MCP Server.`);
  }

  // Double-layer security check: verify permission even if ChatGPT tried to call hidden tool
  if (typeof tool.permissionCheck === 'function') {
    const isAllowed = tool.permissionCheck(ctx, args);
    if (!isAllowed) {
      throw new Error(`Permission Denied: Your account role (${ctx.permissions.role}) does not have permission to execute '${toolName}'.`);
    }
  }

  return await tool.handler(args, ctx);
}

module.exports = {
  allTools,
  getAvailableTools,
  executeTool
};
