const Asset = require('../models/Asset');
const User = require('../models/User');
const Department = require('../models/Department');

// @desc    Get all assets
// @route   GET /api/assets
// @access  Private
const getAssets = async (req, res) => {
  try {
    const { 
      category, 
      status, 
      department, 
      assignedTo,
      search,
      company 
    } = req.query;

    // Build query
    const query = {};
    
    // Company filtering
    if (req.user.role === 'super-admin' && req.query.showAll === 'true') {
      // Super admin can see all
    } else {
      query.company = req.user.companyCode;
    }

    // Apply filters
    if (category && category !== 'all') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (department) query.department = department;
    if (assignedTo) query.assignedTo = assignedTo;

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { serialNumber: { $regex: search, $options: 'i' } },
        { assetTag: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Execute query with population
    const assets = await Asset.find(query)
      .populate('assignedTo', 'name email employeeId department')
      .populate('department', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('history.performedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await Asset.countDocuments(query);

    res.json({
      success: true,
      assets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching assets',
      error: error.message
    });
  }
};

// @desc    Get asset by ID
// @route   GET /api/assets/:id
// @access  Private
const getAssetById = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('assignedTo', 'name email employeeId department')
      .populate('department', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('history.performedBy', 'name email')
      .populate('maintenanceRecords.performedBy', 'name email');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check company access
    if (req.user.role !== 'super-admin' && asset.company !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      asset
    });
  } catch (error) {
    console.error('Get asset by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching asset',
      error: error.message
    });
  }
};

// @desc    Create new asset
// @route   POST /api/assets
// @access  Private (Owner/Admin)
const createAsset = async (req, res) => {
  try {
    const {
      name,
      category,
      model,
      serialNumber,
      assetTag,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      supplier,
      manufacturer,
      condition,
      status,
      location,
      department,
      description,
      notes
    } = req.body;

    // Check if serial number already exists
    const existingAsset = await Asset.findOne({ serialNumber });
    if (existingAsset) {
      return res.status(400).json({
        success: false,
        message: 'Asset with this serial number already exists'
      });
    }

    // Create asset
    const asset = await Asset.create({
      name,
      category,
      model,
      serialNumber,
      assetTag,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      supplier,
      manufacturer,
      condition,
      status,
      location,
      department,
      description,
      notes,
      company: req.user.companyCode,
      companyCode: req.user.companyCode,
      createdBy: req.user._id,
      history: [{
        action: 'created',
        performedBy: req.user._id,
        date: new Date(),
        description: `Asset created by ${req.user.name}`
      }]
    });

    res.status(201).json({
      success: true,
      message: 'Asset created successfully',
      asset
    });
  } catch (error) {
    console.error('Create asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating asset',
      error: error.message
    });
  }
};

// @desc    Update asset
// @route   PUT /api/assets/:id
// @access  Private (Owner/Admin)
const updateAsset = async (req, res) => {
  try {
    let asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check company access
    if (req.user.role !== 'super-admin' && asset.company !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Track changes for history
    const changes = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (asset[key] !== value && key !== 'notes') {
        changes.push(`${key}: ${asset[key]} -> ${value}`);
      }
    }

    // Update asset
    asset = await Asset.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        updatedBy: req.user._id,
        $push: {
          history: {
            action: 'updated',
            performedBy: req.user._id,
            date: new Date(),
            description: `Asset updated by ${req.user.name}`,
            details: { changes }
          }
        }
      },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Asset updated successfully',
      asset
    });
  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating asset',
      error: error.message
    });
  }
};

// @desc    Delete asset
// @route   DELETE /api/assets/:id
// @access  Private (Owner/Admin)
const deleteAsset = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check company access
    if (req.user.role !== 'super-admin' && asset.company !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Soft delete or actual delete? For now, actual delete
    await asset.deleteOne();

    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting asset',
      error: error.message
    });
  }
};

// @desc    Bulk delete assets
// @route   POST /api/assets/bulk-delete
// @access  Private (Owner/Admin)
const bulkDeleteAssets = async (req, res) => {
  try {
    const { assetIds } = req.body;

    if (!assetIds || !assetIds.length) {
      return res.status(400).json({
        success: false,
        message: 'No assets selected for deletion'
      });
    }

    // Verify all assets belong to user's company
    const assets = await Asset.find({
      _id: { $in: assetIds },
     company: req.user.companyCode
    });

    if (assets.length !== assetIds.length) {
      return res.status(403).json({
        success: false,
        message: 'Some assets do not belong to your company'
      });
    }

    await Asset.deleteMany({ _id: { $in: assetIds } });

    res.json({
      success: true,
      message: `${assets.length} assets deleted successfully`
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bulk delete',
      error: error.message
    });
  }
};

// @desc    Assign asset to user/department
// @route   POST /api/assets/assign
// @access  Private
const assignAsset = async (req, res) => {
  try {
    const { assetId, assignedTo, department, notes } = req.body;

    const asset = await Asset.findById(assetId);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Check if asset is available
    if (asset.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: `Asset is ${asset.status} and cannot be assigned`
      });
    }

    // Verify assignedTo user exists and belongs to same company
    if (assignedTo) {
      const user = await User.findById(assignedTo);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      if (user.companyCode !== req.user.companyCode) {
        return res.status(403).json({
          success: false,
          message: 'User does not belong to your company'
        });
      }
    }

    // Verify department exists
    if (department) {
      const dept = await Department.findById(department);
      if (!dept) {
        return res.status(404).json({
          success: false,
          message: 'Department not found'
        });
      }
    }

    // Update asset
    asset.assignedTo = assignedTo || null;
    asset.department = department || null;
    asset.assignedDate = new Date();
    asset.status = 'assigned';
    asset.updatedBy = req.user._id;

    // Add to history
    asset.addToHistory(
      'assigned',
      req.user._id,
      `Asset assigned to ${assignedTo ? 'user' : 'department'}`,
      { assignedTo, department, notes }
    );

    await asset.save();

    // Populate for response
    await asset.populate('assignedTo', 'name email employeeId');
    await asset.populate('department', 'name');

    res.json({
      success: true,
      message: 'Asset assigned successfully',
      asset
    });
  } catch (error) {
    console.error('Assign asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while assigning asset',
      error: error.message
    });
  }
};

// @desc    Return asset
// @route   POST /api/assets/:id/return
// @access  Private
const returnAsset = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (asset.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: 'Asset is not currently assigned'
      });
    }

    // Update asset
    asset.assignedTo = null;
    asset.assignedDate = null;
    asset.expectedReturnDate = null;
    asset.status = 'available';
    asset.updatedBy = req.user._id;

    // Add to history
    asset.addToHistory(
      'returned',
      req.user._id,
      `Asset returned by ${req.user.name}`
    );

    await asset.save();

    res.json({
      success: true,
      message: 'Asset returned successfully',
      asset
    });
  } catch (error) {
    console.error('Return asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while returning asset',
      error: error.message
    });
  }
};

// @desc    Schedule maintenance
// @route   POST /api/assets/:id/maintenance
// @access  Private
const scheduleMaintenance = async (req, res) => {
  try {
    const { type, scheduledDate, description, cost, vendor } = req.body;
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Add maintenance record
    const maintenanceRecord = {
      type,
      scheduledDate,
      description,
      cost,
      vendor,
      performedBy: req.user._id
    };

    asset.maintenanceRecords.push(maintenanceRecord);
    
    // Update status if needed
    if (asset.status === 'available' || asset.status === 'assigned') {
      asset.status = 'maintenance';
    }

    // Add to history
    asset.addToHistory(
      'maintenance',
      req.user._id,
      `Maintenance scheduled: ${type}`,
      maintenanceRecord
    );

    asset.updatedBy = req.user._id;
    await asset.save();

    res.json({
      success: true,
      message: 'Maintenance scheduled successfully',
      asset
    });
  } catch (error) {
    console.error('Schedule maintenance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while scheduling maintenance',
      error: error.message
    });
  }
};

// @desc    Complete maintenance
// @route   PUT /api/assets/:id/maintenance/:maintenanceId/complete
// @access  Private
const completeMaintenance = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const maintenance = asset.maintenanceRecords.id(req.params.maintenanceId);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        message: 'Maintenance record not found'
      });
    }

    maintenance.completedDate = new Date();
    maintenance.notes = req.body.notes || maintenance.notes;

    // Update asset status back to available
    asset.status = 'available';

    // Add to history
    asset.addToHistory(
      'maintenance',
      req.user._id,
      'Maintenance completed'
    );

    asset.updatedBy = req.user._id;
    await asset.save();

    res.json({
      success: true,
      message: 'Maintenance completed successfully',
      asset
    });
  } catch (error) {
    console.error('Complete maintenance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while completing maintenance',
      error: error.message
    });
  }
};

// @desc    Get asset history
// @route   GET /api/assets/:id/history
// @access  Private
const getAssetHistory = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('history.performedBy', 'name email')
      .populate('maintenanceRecords.performedBy', 'name email');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    res.json({
      success: true,
      history: asset.history,
      maintenanceRecords: asset.maintenanceRecords
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching history',
      error: error.message
    });
  }
};

// @desc    Get asset statistics
// @route   GET /api/assets/stats
// @access  Private
const getAssetStats = async (req, res) => {
  try {
    const query = {};
    
    if (req.user.role !== 'super-admin') {
      query.company = req.user.companyCode;
    }

    const stats = await Asset.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
          assigned: { $sum: { $cond: [{ $eq: ['$status', 'assigned'] }, 1, 0] } },
          maintenance: { $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] } },
          damaged: { $sum: { $cond: [{ $eq: ['$status', 'damaged'] }, 1, 0] } },
          retired: { $sum: { $cond: [{ $eq: ['$status', 'retired'] }, 1, 0] } },
          totalValue: { $sum: '$purchaseCost' }
        }
      }
    ]);

    const categoryStats = await Asset.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          value: { $sum: '$purchaseCost' }
        }
      }
    ]);

    res.json({
      success: true,
      stats: stats[0] || {
        total: 0,
        available: 0,
        assigned: 0,
        maintenance: 0,
        damaged: 0,
        retired: 0,
        totalValue: 0
      },
      categoryStats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching stats',
      error: error.message
    });
  }
};

module.exports = {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
  bulkDeleteAssets,
  assignAsset,
  returnAsset,
  scheduleMaintenance,
  completeMaintenance,
  getAssetHistory,
  getAssetStats
};