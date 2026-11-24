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
 * Returns only tools allowed for the given user context (Dynamic Tool Gating).
 * Automatically enriches descriptions with company aliases (e.g. TechSoft, Tech Soft, CIIS)
 * so Claude's dynamic Tool Search indexes and matches them instantly from voice mic and text.
 */
function getAvailableTools(ctx) {
  const companyCode = String(ctx?.companyCode || '').toUpperCase();
  const role = String(ctx?.permissions?.role || 'user').toLowerCase();
  const userName = ctx?.user?.name || ctx?.user?.email || 'User';

  const isTechSoft = companyCode === 'TECH334753' || companyCode.includes('TECH');
  const companyAliases = isTechSoft
    ? 'TechSoft / Tech Soft / Tech Soft Admin / techsoft-admin / TechSoft Admin'
    : 'CIIS / CIIS Network / Career';

  const searchKeywords = isTechSoft
    ? 'techsoft, tech soft, tech soft admin, techsoft-admin, techsoft admin, test admin, tech334753'
    : 'ciis, ciis network, career, ciis-employee, ciis-owner';

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
    description: `[Company: ${companyAliases} | Role: ${role} | User: ${userName} | Voice & Text Ready] ${t.description} (Keywords: ${searchKeywords}, ${t.name.replace(/_/g, ' ')})`,
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
