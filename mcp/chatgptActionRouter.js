const express = require('express');
const router = express.Router();
const { authenticateMcpKey } = require('./auth');
const { allTools, executeTool } = require('./tools');

/**
 * Authentication middleware for ChatGPT actions
 */
async function chatgptAuth(req, res, next) {
  try {
    const rawKey = req.headers['x-ciis-api-key'] || req.headers.authorization;
    if (!rawKey) {
      return res.status(401).json({
        error: 'Unauthorized: Missing CIIS API Key in Authorization header (Bearer ciis_live_...)'
      });
    }

    const authContext = await authenticateMcpKey(String(rawKey));
    req.mcpAuth = authContext;
    next();
  } catch (error) {
    return res.status(403).json({
      error: error.message || 'Forbidden'
    });
  }
}

/**
 * GET /api/mcp/openapi.json - Generates OpenAPI 3.1.0 schema for ChatGPT Custom GPT Actions
 */
router.get('/openapi.json', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'https://cds.ciisnetwork.in';

  const paths = {};

  allTools.forEach(tool => {
    const pathKey = `/api/mcp/action/${tool.name}`;
    paths[pathKey] = {
      post: {
        operationId: tool.name,
        summary: tool.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        description: tool.description,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: tool.parameters || { type: 'object', properties: {} }
            }
          }
        },
        responses: {
          '200': {
            description: 'Successful tool execution result',
            content: {
              'application/json': {
                schema: { type: 'object' }
              }
            }
          },
          '403': {
            description: 'Permission Denied: User role does not have access'
          }
        }
      }
    };
  });

  const openApiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'CIIS Network MCP & AI Portal Actions',
      description: 'API for ChatGPT to manage tasks, attendance, client plans, and unified report exports with strict role-based access control.',
      version: '1.0.0'
    },
    servers: [
      { url: baseUrl, description: 'Production Server' }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'CIIS-Live-Key',
          description: 'Enter your CIIS API key (ciis_live_...)'
        }
      }
    },
    security: [
      { ApiKeyAuth: [] }
    ],
    paths
  };

  return res.status(200).json(openApiSpec);
});

/**
 * POST /api/mcp/action/:toolName - Executes a specific tool called by ChatGPT
 */
router.post('/action/:toolName', chatgptAuth, async (req, res) => {
  try {
    const { toolName } = req.params;
    const args = req.body || {};

    const result = await executeTool(toolName, args, req.mcpAuth);
    return res.status(200).json({
      success: true,
      result
    });
  } catch (error) {
    const status = error.message.includes('Permission Denied') ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
