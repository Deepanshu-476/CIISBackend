  const express = require('express');
  const router = express.Router();
  const MenuAccess = require('../models/MenuAccess');

  // Get menu access for specific department and job role
  router.get('/', async (req, res) => {
    try {
      const { department, jobRole } = req.query;
      
      if (!department || !jobRole) {
        return res.status(400).json({ error: 'Department and job role are required' });
      }
      
      const access = await MenuAccess.findOne({ department, jobRole });
      
      if (access) {
        res.json(access);
      } else {
        // Return default access if not configured
        res.json({
          department,
          jobRole,
          accessItems: getDefaultAccess(jobRole),
          isDefault: true
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save/Update menu access
  router.post('/', async (req, res) => {
    try {
      const { department, jobRole, accessItems, updatedBy } = req.body;
      
      // Validation
      if (!department || !jobRole || !accessItems || !Array.isArray(accessItems) || !updatedBy) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      let menuAccess = await MenuAccess.findOne({ department, jobRole });
      
      if (menuAccess) {
        menuAccess.accessItems = accessItems;
        menuAccess.updatedBy = updatedBy;
        menuAccess.updatedAt = new Date();
      } else {
        menuAccess = new MenuAccess({
          department,
          jobRole,
          accessItems,
          createdBy: updatedBy,
          updatedBy
        });
      }
      
      await menuAccess.save();
      res.json(menuAccess);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update existing configuration
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { accessItems, updatedBy } = req.body;
      
      if (!accessItems || !Array.isArray(accessItems) || !updatedBy) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      const menuAccess = await MenuAccess.findByIdAndUpdate(
        id,
        { 
          accessItems, 
          updatedBy, 
          updatedAt: new Date() 
        },
        { new: true }
      );
      
      if (!menuAccess) {
        return res.status(404).json({ error: 'Configuration not found' });
      }
      
      res.json(menuAccess);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete configuration
  router.delete('/:id', async (req, res) => {
    try {
      const menuAccess = await MenuAccess.findByIdAndDelete(req.params.id);
      
      if (!menuAccess) {
        return res.status(404).json({ error: 'Configuration not found' });
      }
      
      res.json({ message: 'Configuration deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all configurations
  router.get('/all', async (req, res) => {
    try {
      const accesses = await MenuAccess.find().sort({ updatedAt: -1 });
      res.json(accesses);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper function for default access
  function getDefaultAccess(jobRole) {
    const defaults = {
      admin: ['dashboard', 'attendance', 'my-leaves', 'my-assets', 'emp-details', 'emp-attendance', 'emp-leaves', 'emp-assets', 'create-user'],
      user: ['dashboard', 'attendance', 'my-leaves', 'my-assets', 'create-task', 'employee-project', 'alerts', 'employee-meeting'],
      hr: ['dashboard', 'attendance', 'my-leaves', 'my-assets', 'emp-details', 'emp-attendance', 'emp-leaves', 'emp-assets', 'create-user'],
      manager: ['dashboard', 'attendance', 'my-leaves', 'my-assets', 'create-task', 'employee-project', 'alerts', 'employee-meeting', 'emp-details', 'emp-attendance', 'emp-leaves', 'emp-assets', 'admin-task-create', 'emp-client', 'emp-all-task', 'admin-meeting'],
      superadmin: ['*'] // All access
    };
    
    return defaults[jobRole?.toLowerCase()] || defaults.user;
  }

  module.exports = router;