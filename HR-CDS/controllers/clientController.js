const Client = require('../models/Client');
const Service = require('../models/Service');

const getAllClients = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      status,
      projectManager,
      service
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (projectManager) filter.projectManager = projectManager;
    if (service) filter.services = service;
    
    // Search across multiple fields
    if (search) {
      filter.$or = [
        { client: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const clients = await Client.find(filter)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Client.countDocuments(filter);

    res.json({
      success: true,
      data: clients,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching clients',
      error: error.message
    });
  }
};

const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching client',
      error: error.message
    });
  }
};

const addClient = async (req, res) => {
  try {
    const {
      client,
      company,
      city,
      projectManager,
      services,
      status,
      progress,
      email,
      phone,
      address,
      notes
    } = req.body;

    // Validation
    if (!client || !company || !city || !projectManager) {
      return res.status(400).json({
        success: false,
        message: 'Client name, company, city, and project manager are required'
      });
    }

    // Validate services exist
    if (services && services.length > 0) {
      const existingServices = await Service.find({ 
        servicename: { $in: services } 
      });
      
      if (existingServices.length !== services.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more services do not exist'
        });
      }
    }

    const newClient = new Client({
      client,
      company,
      city,
      projectManager,
      services: services || [],
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email,
      phone,
      address,
      notes
    });

    await newClient.save();

    res.status(201).json({
      success: true,
      message: 'Client added successfully',
      data: newClient
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error adding client',
      error: error.message
    });
  }
};

const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate services exist if being updated
    if (updateData.services && updateData.services.length > 0) {
      const existingServices = await Service.find({ 
        servicename: { $in: updateData.services } 
      });
      
      if (existingServices.length !== updateData.services.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more services do not exist'
        });
      }
    }

    const client = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: client
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating client',
      error: error.message
    });
  }
};

const updateClientProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const { completed, total } = req.body;

    if (completed === undefined || total === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Completed and total values are required'
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.updateProgress(parseInt(completed), parseInt(total));

    res.json({
      success: true,
      message: 'Client progress updated successfully',
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating client progress',
      error: error.message
    });
  }
};

const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    
    const client = await Client.findByIdAndDelete(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client deleted successfully',
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting client',
      error: error.message
    });
  }
};

const getClientStats = async (req, res) => {
  try {
    const stats = await Client.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching client statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllClients,
  getClientById,
  addClient,
  updateClient,
  updateClientProgress,
  deleteClient,
  getClientStats
};