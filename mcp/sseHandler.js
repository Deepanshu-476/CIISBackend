const express = require('express');
const router = express.Router();
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { authenticateMcpKey } = require('./auth');
const { createMcpServer } = require('./createMcpServer');

// In-memory mapping of active transports by sessionId
const activeTransports = new Map();

/**
 * Middleware to extract and validate API Key from header or query
 */
async function mcpAuthMiddleware(req, res, next) {
  try {
    const rawKey = req.headers['x-ciis-api-key'] || 
                   req.headers.authorization || 
                   req.query.apiKey;

    if (!rawKey) {
      return res.status(401).json({
        error: 'Unauthorized: Missing CIIS API Key in Authorization header, x-ciis-api-key, or apiKey query parameter.'
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
 * GET /api/mcp/sse - Establishes Server-Sent Events stream for ChatGPT / external AI
 */
router.get('/sse', mcpAuthMiddleware, async (req, res) => {
  try {
    const transport = new SSEServerTransport('/api/mcp/messages', res);
    const server = createMcpServer(req.mcpAuth);

    activeTransports.set(transport.sessionId, {
      transport,
      server,
      auth: req.mcpAuth
    });

    res.on('close', () => {
      activeTransports.delete(transport.sessionId);
    });

    await server.connect(transport);
  } catch (err) {
    console.error('[CIIS MCP SSE Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish MCP SSE connection' });
    }
  }
});

/**
 * POST /api/mcp/messages - Receives incoming JSON-RPC tool calls from client
 */
router.post('/messages', async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    const session = activeTransports.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: `MCP Session '${sessionId}' not found or closed.` });
    }

    await session.transport.handlePostMessage(req, res);
  } catch (err) {
    console.error('[CIIS MCP PostMessage Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process MCP message' });
    }
  }
});

module.exports = router;
