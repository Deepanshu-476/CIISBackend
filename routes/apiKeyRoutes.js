const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const ApiKey = require('../models/ApiKey');

/**
 * GET /api/mcp/keys - Lists API keys for user/company
 */
router.get('/keys', protect, async (req, res) => {
  try {
    const companyCode = String(req.user?.companyCode || '').toUpperCase();
    const isOwnerOrAdmin = req.user?.isOwner || 
                           req.user?.isSuperAdmin || 
                           String(req.user?.companyRole || '').toLowerCase().includes('owner') ||
                           String(req.user?.companyRole || '').toLowerCase().includes('admin');

    const query = { companyCode, isActive: true };
    if (!isOwnerOrAdmin) {
      query.user = req.user._id;
    }

    const keys = await ApiKey.find(query)
      .populate('user', 'name email role companyRole')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      keys: keys.map(k => ({
        id: k._id,
        name: k.name,
        keyPrefix: `${k.keyPrefix}...`,
        role: k.role,
        userName: k.user?.name || 'Unknown',
        userEmail: k.user?.email || 'Unknown',
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt
      }))
    });
  } catch (err) {
    console.error('Error fetching API keys:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch API keys' });
  }
});

/**
 * POST /api/mcp/keys - Creates a new API key for ChatGPT / Claude / MCP
 */
router.post('/keys', protect, async (req, res) => {
  try {
    const { name = 'AI MCP Key' } = req.body;
    const companyCode = String(req.user?.companyCode || '').toUpperCase();
    const companyId = req.user?.company?._id || req.user?.company;

    if (!companyCode || !companyId) {
      return res.status(400).json({ success: false, message: 'User does not belong to a valid company.' });
    }

    const { fullKey, keyPrefix, keyHash } = ApiKey.generateKey();
    const role = String(req.user?.companyRole || req.user?.role || 'employee').toLowerCase();

    const apiKeyDoc = await ApiKey.create({
      name: name.trim(),
      keyPrefix,
      keyHash,
      user: req.user._id,
      company: companyId,
      companyCode,
      role,
      isActive: true
    });

    return res.status(201).json({
      success: true,
      message: 'API Key generated successfully. Copy it now, it will not be shown again.',
      apiKey: fullKey,
      keyInfo: {
        id: apiKeyDoc._id,
        name: apiKeyDoc.name,
        keyPrefix: `${keyPrefix}...`,
        role: apiKeyDoc.role,
        createdAt: apiKeyDoc.createdAt
      }
    });
  } catch (err) {
    console.error('Error generating API key:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate API key' });
  }
});

/**
 * DELETE /api/mcp/keys/:id - Revokes an API key
 */
router.delete('/keys/:id', protect, async (req, res) => {
  try {
    const companyCode = String(req.user?.companyCode || '').toUpperCase();
    const key = await ApiKey.findOne({ _id: req.params.id, companyCode });

    if (!key) {
      return res.status(404).json({ success: false, message: 'API key not found' });
    }

    const isOwnerOrAdmin = req.user?.isOwner || 
                           req.user?.isSuperAdmin || 
                           String(req.user?.companyRole || '').toLowerCase().includes('owner') ||
                           String(req.user?.companyRole || '').toLowerCase().includes('admin');

    if (!isOwnerOrAdmin && String(key.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only revoke your own API keys.' });
    }

    key.isActive = false;
    await key.save();

    return res.status(200).json({
      success: true,
      message: 'API Key revoked successfully.'
    });
  } catch (err) {
    console.error('Error revoking API key:', err);
    return res.status(500).json({ success: false, message: 'Failed to revoke API key' });
  }
});

module.exports = router;
