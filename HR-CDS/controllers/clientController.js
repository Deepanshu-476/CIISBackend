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
    if (projectManager) filter.projectManager = { $in: [projectManager] }; // UPDATED: For array field
    if (service) filter.services = service;
    
    // Search across multiple fields
    if (search) {
      filter.$or = [
        { client: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } } // NEW: Search in description
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
      projectManager, // Can be string or array
      projectManagers, // Alternative field for multi-select
      services,
      status,
      progress,
      email,
      phone,
      address,
      description, // NEW: Added description
      notes
    } = req.body;

    // Validation
    if (!client || !company || !city) {
      return res.status(400).json({
        success: false,
        message: 'Client name, company, and city are required'
      });
    }

    // Handle project managers - support both single and multiple
    let finalProjectManagers = [];
    
    if (projectManagers && Array.isArray(projectManagers) && projectManagers.length > 0) {
      // Use multi-select values
      finalProjectManagers = projectManagers.filter(manager => manager && manager.trim().length > 0);
    } else if (projectManager) {
      // Use single select value as array
      if (Array.isArray(projectManager)) {
        finalProjectManagers = projectManager.filter(manager => manager && manager.trim().length > 0);
      } else {
        finalProjectManagers = [projectManager.trim()];
      }
    }
    
    // Validate at least one project manager
    if (finalProjectManagers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one project manager is required'
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
      client: client.trim(),
      company: company.trim(),
      city: city.trim(),
      projectManager: finalProjectManagers, // Store as array
      services: services || [],
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email: email ? email.trim().toLowerCase() : undefined,
      phone: phone ? phone.trim() : undefined,
      address: address ? address.trim() : undefined,
      description: description ? description.trim() : '', // NEW: Added description
      notes: notes ? notes.trim() : undefined
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
    const {
      client,
      company,
      city,
      projectManager,
      projectManagers,
      services,
      status,
      progress,
      email,
      phone,
      address,
      description, // NEW: Added description
      notes
    } = req.body;

    // Handle project managers - support both single and multiple
    let finalProjectManagers = [];
    
    if (projectManagers && Array.isArray(projectManagers) && projectManagers.length > 0) {
      finalProjectManagers = projectManagers.filter(manager => manager && manager.trim().length > 0);
    } else if (projectManager) {
      if (Array.isArray(projectManager)) {
        finalProjectManagers = projectManager.filter(manager => manager && manager.trim().length > 0);
      } else {
        finalProjectManagers = [projectManager.trim()];
      }
    }
    
    // If project managers are being updated, validate at least one
    if ((projectManager !== undefined || projectManagers !== undefined) && finalProjectManagers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one project manager is required'
      });
    }

    // Build update object
    const updateData = {};
    
    if (client !== undefined) updateData.client = client.trim();
    if (company !== undefined) updateData.company = company.trim();
    if (city !== undefined) updateData.city = city.trim();
    if (finalProjectManagers.length > 0) updateData.projectManager = finalProjectManagers;
    if (services !== undefined) updateData.services = services;
    if (status !== undefined) updateData.status = status;
    if (progress !== undefined) updateData.progress = progress;
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (description !== undefined) updateData.description = description.trim(); // NEW: Added description
    if (notes !== undefined) updateData.notes = notes.trim();

    // Validate services exist if being updated
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

    const clientDoc = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: clientDoc
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

const getManagerStats = async (req, res) => {
  try {
    const stats = await Client.getManagerStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
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