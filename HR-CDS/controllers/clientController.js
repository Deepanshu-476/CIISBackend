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
    
    if (status && status !== 'All') filter.status = status;
    
    if (projectManager && projectManager !== 'All') {
      filter.projectManager = projectManager;
    }
    
    if (service && service !== 'All') {
      filter.services = service;
    }
    
    // Enhanced search functionality
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { client: searchRegex },
        { company: searchRegex },
        { city: searchRegex },
        { email: searchRegex },
        { description: searchRegex },
        { 'projectManager': searchRegex }
      ];
    }

    // Sort options
    const sortOptions = {};
    const validSortFields = ['client', 'company', 'city', 'status', 'createdAt', 'updatedAt'];
    
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      Client.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: clients,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
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
    
    const client = await Client.findById(id).lean();
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
    console.error('Error fetching client:', error);
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
      projectManagers, // Array from frontend
      services,
      status,
      progress,
      email,
      phone,
      address,
      description,
      notes
    } = req.body;

    // Validation
    const errors = [];
    
    if (!client || client.trim().length === 0) {
      errors.push('Client name is required');
    }
    
    if (!company || company.trim().length === 0) {
      errors.push('Company name is required');
    }
    
    if (!city || city.trim().length === 0) {
      errors.push('City is required');
    }
    
    if (!projectManagers || !Array.isArray(projectManagers) || projectManagers.length === 0) {
      errors.push('At least one project manager is required');
    } else {
      // Validate each project manager
      const validManagers = projectManagers.filter(manager => 
        manager && typeof manager === 'string' && manager.trim().length > 0
      );
      
      if (validManagers.length === 0) {
        errors.push('Valid project managers are required');
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Validate services exist if provided
    if (services && services.length > 0) {
      const serviceNames = services.filter(s => s && typeof s === 'string' && s.trim().length > 0);
      if (serviceNames.length > 0) {
        const existingServices = await Service.find({ 
          servicename: { $in: serviceNames } 
        });
        
        if (existingServices.length !== serviceNames.length) {
          const missingServices = serviceNames.filter(name => 
            !existingServices.some(s => s.servicename === name)
          );
          
          return res.status(400).json({
            success: false,
            message: 'Some services do not exist',
            missingServices
          });
        }
      }
    }

    // Clean project managers
    const cleanProjectManagers = projectManagers
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());

    // Create new client
    const newClient = new Client({
      client: client.trim(),
      company: company.trim(),
      city: city.trim(),
      projectManager: cleanProjectManagers,
      services: services || [],
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      description: description ? description.trim() : '',
      notes: notes ? notes.trim() : ''
    });

    await newClient.save();

    res.status(201).json({
      success: true,
      message: 'Client added successfully',
      data: newClient
    });
  } catch (error) {
    console.error('Error adding client:', error);
    
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
    const {
      client,
      company,
      city,
      projectManagers,
      services,
      status,
      progress,
      email,
      phone,
      address,
      description,
      notes
    } = req.body;

    // Find client
    const existingClient = await Client.findById(id);
    if (!existingClient) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Validation
    const errors = [];
    
    if (client !== undefined && (!client || client.trim().length === 0)) {
      errors.push('Client name cannot be empty');
    }
    
    if (company !== undefined && (!company || company.trim().length === 0)) {
      errors.push('Company name cannot be empty');
    }
    
    if (city !== undefined && (!city || city.trim().length === 0)) {
      errors.push('City cannot be empty');
    }
    
    if (projectManagers !== undefined) {
      if (!Array.isArray(projectManagers) || projectManagers.length === 0) {
        errors.push('At least one project manager is required');
      } else {
        const validManagers = projectManagers.filter(manager => 
          manager && typeof manager === 'string' && manager.trim().length > 0
        );
        
        if (validManagers.length === 0) {
          errors.push('Valid project managers are required');
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Validate services if being updated
    if (services !== undefined) {
      const serviceNames = services.filter(s => s && typeof s === 'string' && s.trim().length > 0);
      if (serviceNames.length > 0) {
        const existingServices = await Service.find({ 
          servicename: { $in: serviceNames } 
        });
        
        if (existingServices.length !== serviceNames.length) {
          const missingServices = serviceNames.filter(name => 
            !existingServices.some(s => s.servicename === name)
          );
          
          return res.status(400).json({
            success: false,
            message: 'Some services do not exist',
            missingServices
          });
        }
      }
    }

    // Build update object
    const updateData = {};
    
    if (client !== undefined) updateData.client = client.trim();
    if (company !== undefined) updateData.company = company.trim();
    if (city !== undefined) updateData.city = city.trim();
    if (projectManagers !== undefined) {
      updateData.projectManager = projectManagers
        .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
        .map(manager => manager.trim());
    }
    if (services !== undefined) updateData.services = services;
    if (status !== undefined) updateData.status = status;
    if (progress !== undefined) updateData.progress = progress;
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (notes !== undefined) updateData.notes = notes.trim();

    // Update client
    const updatedClient = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: updatedClient
    });
  } catch (error) {
    console.error('Error updating client:', error);
    
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
    console.error('Error updating client progress:', error);
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
    console.error('Error deleting client:', error);
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
    console.error('Error fetching client statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching client statistics',
      error: error.message
    });
  }
};

const getManagerStats = async (req, res) => {
  try {
    const stats = await Client.getManagerStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching manager statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching manager statistics',
      error: error.message
    });
  }
};

const addProjectManager = async (req, res) => {
  try {
    const { id } = req.params;
    const { managerName } = req.body;

    if (!managerName || managerName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Manager name is required'
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.addProjectManager(managerName.trim());

    res.json({
      success: true,
      message: 'Project manager added successfully',
      data: client
    });
  } catch (error) {
    console.error('Error adding project manager:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding project manager',
      error: error.message
    });
  }
};

const removeProjectManager = async (req, res) => {
  try {
    const { id } = req.params;
    const { managerName } = req.body;

    if (!managerName || managerName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Manager name is required'
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.removeProjectManager(managerName.trim());

    res.json({
      success: true,
      message: 'Project manager removed successfully',
      data: client
    });
  } catch (error) {
    console.error('Error removing project manager:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing project manager',
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
  getClientStats,
  getManagerStats,
  addProjectManager,
  removeProjectManager
};