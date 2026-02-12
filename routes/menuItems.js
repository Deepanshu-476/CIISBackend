const express = require('express');
const router = express.Router();
const MenuItem = require('../models/MenuItem');

// Get all active menu items
router.get('/', async (req, res) => {
  try {
    const items = await MenuItem.find({ isActive: true }).sort({ order: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all menu items (including inactive for admin)
router.get('/all', async (req, res) => {
  try {
    const items = await MenuItem.find().sort({ order: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new menu item
router.post('/', async (req, res) => {
  try {
    const { name, icon, path, category, isActive = true, order = 0 } = req.body;
    
    if (!name || !path) {
      return res.status(400).json({ error: 'Name and path are required' });
    }
    
    // Check if menu item already exists
    const existingItem = await MenuItem.findOne({ 
      $or: [{ name }, { path }] 
    });
    
    if (existingItem) {
      return res.status(400).json({ error: 'Menu item with this name or path already exists' });
    }
    
    const menuItem = new MenuItem({
      name,
      icon,
      path,
      category,
      isActive,
      order,
      createdAt: new Date()
    });
    
    await menuItem.save();
    res.status(201).json(menuItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update menu item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const menuItem = await MenuItem.findByIdAndUpdate(
      id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    
    if (!menuItem) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    
    res.json(menuItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete menu item (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const menuItem = await MenuItem.findByIdAndUpdate(
      req.params.id, 
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );
    
    if (!menuItem) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    
    res.json({ message: 'Menu item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore menu item
router.put('/:id/restore', async (req, res) => {
  try {
    const menuItem = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { isActive: true, updatedAt: new Date() },
      { new: true }
    );
    
    if (!menuItem) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    
    res.json(menuItem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get('/test', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Menu Access API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

module.exports = router;
console.log("✅ menuItems.js loaded successfully");