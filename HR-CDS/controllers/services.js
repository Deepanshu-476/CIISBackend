const Service = require('../models/Service');

// Get all services (with companyCode filter)
const getAllServices = async (req, res) => {
  try {
    const { companyCode } = req.query;
    
    let query = {};
    
    // Filter by companyCode if provided
    if (companyCode) {
      query.companyCode = companyCode.toUpperCase();
    }
    
    const services = await Service.find(query).sort({ servicename: 1 });

    res.json({
      success: true,
      data: services,
      count: services.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching services',
      error: error.message
    });
  }
};

// Add new service (with companyCode)
const addService = async (req, res) => {
  try {
    const { servicename, companyCode } = req.body;

    // Validate required fields
    if (!servicename || servicename.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Service name is required'
      });
    }

    if (!companyCode || companyCode.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }

    // Create new service with companyCode
    const newService = new Service({
      servicename: servicename.trim(),
      companyCode: companyCode.trim().toUpperCase(),
      createdBy: req.user?._id // Optional: if you have user authentication
    });

    await newService.save();

    res.status(201).json({
      success: true,
      message: 'Service added successfully',
      data: newService
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Service already exists for this company'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error adding service',
      error: error.message
    });
  }
};

// Delete service
const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    
    const service = await Service.findByIdAndDelete(id);
    
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.json({
      success: true,
      message: 'Service deleted successfully',
      data: service
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting service',
      error: error.message
    });
  }
};

// Update service
const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { servicename, companyCode } = req.body;

    if (!servicename || servicename.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Service name is required'
      });
    }

    const updateData = {
      servicename: servicename.trim()
    };

    // Update companyCode if provided
    if (companyCode && companyCode.trim() !== '') {
      updateData.companyCode = companyCode.trim().toUpperCase();
    }

    const service = await Service.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.json({
      success: true,
      message: 'Service updated successfully',
      data: service
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Service name already exists for this company'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating service',
      error: error.message
    });
  }
};

// Get services by company code
const getServicesByCompany = async (req, res) => {
  try {
    const { companyCode } = req.params;

    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }

    const services = await Service.find({ 
      companyCode: companyCode.toUpperCase() 
    }).sort({ servicename: 1 });

    res.json({
      success: true,
      data: services,
      count: services.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching services for company',
      error: error.message
    });
  }
};

module.exports = {
  getAllServices,
  addService,
  deleteService,
  updateService,
  getServicesByCompany
};
console.log("✅ servicesController.js loaded successfully");