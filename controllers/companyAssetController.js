const CompanyAsset = require('../models/CompanyAsset');
const { getPaginationOptions, buildPaginationMeta } = require('../utils/pagination');




const getCompanyAssets = async (req, res) => {
  try {
    void 0;
    void 0;

    if (!req.user || !req.user.companyCode) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated or company code missing'
      });
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const query = { companyCode: req.user.companyCode };
    const search = String(req.query.search || req.query.q || '').trim();
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { status: searchRegex }
      ];
    }
    void 0;

    const [assets, total] = await Promise.all([
      CompanyAsset.find(query)
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CompanyAsset.countDocuments(query)
    ]);

    void 0;

    res.json({
      success: true,
      assets,
      count: assets.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
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




const createCompanyAsset = async (req, res) => {
  try {
    void 0;
    void 0;

    
    if (!req.user) {
      void 0;
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { name, description, quantity, branch } = req.body;

    
    if (!name || !name.trim()) {
      void 0;
      return res.status(400).json({
        success: false,
        message: 'Asset name is required'
      });
    }

    
    if (!req.user.companyCode) {
      void 0;
      return res.status(400).json({
        success: false,
        message: 'Company code not found for user'
      });
    }

    
    const assetData = {
      name: name.trim(),
      description: description ? description.trim() : '',
      quantity: quantity || 0,
      status: 'Available',
      branch: branch || null,
      company: req.user.companyName || req.user.company || 'Unknown',
      companyCode: req.user.companyCode,
      createdBy: req.user._id
    };

    void 0;

    
    const asset = await CompanyAsset.create(assetData);
    void 0;
    void 0; 

    
    await asset.populate('createdBy', 'name email');
    await asset.populate('branch', 'name branchCode');

    res.status(201).json({
      success: true,
      message: 'Company asset created successfully',
      asset
    });
  } catch (error) {
    console.error('❌ Create company asset error:', error);
    
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }

    
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






const deleteCompanyAsset = async (req, res) => {
  try {
    void 0;
    void 0;

    const asset = await CompanyAsset.findById(req.params.id);

    if (!asset) {
      void 0;
      return res.status(404).json({
        success: false,
        message: 'Company asset not found'
      });
    }

    void 0;
    void 0;
    void 0;

    
    if (asset.companyCode !== req.user.companyCode) {
      void 0;
      return res.status(403).json({
        success: false,
        message: 'Access denied - Asset belongs to different company'
      });
    }

    await asset.deleteOne();
    void 0;

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
  deleteCompanyAsset
};
