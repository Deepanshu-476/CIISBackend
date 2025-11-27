const Service = require('../models/Service');

// Get all services
const getAllServices = async (req, res) => {
  try {
    const services = await Service.find().sort({ servicename: 1 });

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

// Add new service
const addService = async (req, res) => {
  try {
    const { servicename } = req.body;

    if (!servicename || servicename.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Service name is required'
      });
    }

    const newService = new Service({
      servicename: servicename.trim()
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
        message: 'Service already exists'
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
    const { servicename } = req.body;

    if (!servicename || servicename.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Service name is required'
      });
    }

    const service = await Service.findByIdAndUpdate(
      id,
      { servicename: servicename.trim() },
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
        message: 'Service name already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating service',
      error: error.message
    });
  }
};

module.exports = {
  getAllServices,
  addService,
  deleteService,
  updateService
};