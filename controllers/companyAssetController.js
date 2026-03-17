const CompanyAsset = require('../models/CompanyAsset');

// @desc    Get all company assets
// @route   GET /api/company-assets
// @access  Private
const getCompanyAssets = async (req, res) => {
  try {
    console.log('🔍 GET /company-assets - User:', req.user?._id);
    console.log('🔍 Company code:', req.user?.companyCode);

    if (!req.user || !req.user.companyCode) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated or company code missing'
      });
    }

    const query = { companyCode: req.user.companyCode };
    console.log('🔍 Query:', query);

    const assets = await CompanyAsset.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${assets.length} assets`);

    res.json({
      success: true,
      assets
    });
  } catch (error) {
    console.error('❌ Get company assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching company assets',
      error: error.message
    });
  }
};

// @desc    Create new company asset (with default status = Available)
// @route   POST /api/company-assets
// @access  Private
const createCompanyAsset = async (req, res) => {
  try {
    console.log('🔍 POST /company-assets - Request body:', req.body);
    console.log('🔍 User:', req.user);

    // Validate user
    if (!req.user) {
      console.log('❌ No user found in request');
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { name, description } = req.body;

    // Validate name
    if (!name || !name.trim()) {
      console.log('❌ Name validation failed');
      return res.status(400).json({
        success: false,
        message: 'Asset name is required'
      });
    }

    // Check company code
    if (!req.user.companyCode) {
      console.log('❌ Company code missing from user');
      return res.status(400).json({
        success: false,
        message: 'Company code not found for user'
      });
    }

    // Prepare asset data with default status = 'Available'
    const assetData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      status: 'Available', // Default status set to Available
      company: req.user.companyName || req.user.company || 'Unknown',
      companyCode: req.user.companyCode,
      createdBy: req.user._id
    };

    console.log('📦 Asset data to save:', assetData);

    // Create asset
    const asset = await CompanyAsset.create(assetData);
    console.log('✅ Asset created successfully:', asset._id);
    console.log('✅ Asset status:', asset.status); // Should show 'Available'

    // Populate createdBy for response
    await asset.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Company asset created successfully',
      asset
    });
  } catch (error) {
    console.error('❌ Create company asset error:', error);
    
    // Check for validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }

    // Check for duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while creating company asset',
      error: error.message
    });
  }
};

// @desc    Update asset status
// @route   PUT /api/company-assets/:id/status
// @access  Private
const updateAssetStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    console.log('🔍 PUT /company-assets/:id/status - ID:', id);
    console.log('🔍 New status:', status);

    // Validate status
    const validStatuses = ['Available', 'Assigned', 'Maintenance', 'Damaged', 'Retired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const asset = await CompanyAsset.findById(id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Company asset not found'
      });
    }

    // Check company access
    if (asset.companyCode !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - Asset belongs to different company'
      });
    }

    // Update status
    asset.status = status;
    await asset.save();

    console.log('✅ Status updated successfully');

    res.json({
      success: true,
      message: 'Asset status updated successfully',
      asset
    });
  } catch (error) {
    console.error('❌ Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating status',
      error: error.message
    });
  }
};

// @desc    Delete company asset
// @route   DELETE /api/company-assets/:id
// @access  Private
const deleteCompanyAsset = async (req, res) => {
  try {
    console.log('🔍 DELETE /company-assets/:id - ID:', req.params.id);
    console.log('🔍 User:', req.user?._id);

    const asset = await CompanyAsset.findById(req.params.id);

    if (!asset) {
      console.log('❌ Asset not found');
      return res.status(404).json({
        success: false,
        message: 'Company asset not found'
      });
    }

    console.log('✅ Asset found:', asset._id);
    console.log('🔍 Asset companyCode:', asset.companyCode);
    console.log('🔍 User companyCode:', req.user.companyCode);

    // Check company access
    if (asset.companyCode !== req.user.companyCode) {
      console.log('❌ Company mismatch - Access denied');
      return res.status(403).json({
        success: false,
        message: 'Access denied - Asset belongs to different company'
      });
    }

    await asset.deleteOne();
    console.log('✅ Asset deleted successfully');

    res.json({
      success: true,
      message: 'Company asset deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete company asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting company asset',
      error: error.message
    });
  }
};

module.exports = {
  getCompanyAssets,
  createCompanyAsset,
  updateAssetStatus,
  deleteCompanyAsset
};