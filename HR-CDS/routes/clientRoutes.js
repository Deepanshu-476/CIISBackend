const express = require('express');
const router = express.Router();
const auth = require('../../middleware/authMiddleware');

const serviceController = require('../controllers/services');
const {
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
} = require('../controllers/clientController');

// ✅ FIXED: Specific routes first, then parameter routes
// Service Routes
router.get('/services', serviceController.getAllServices);
router.post('/services', serviceController.addService);
// router.get('/services/popular', serviceController.getPopularServices);
router.put('/services/:id', serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);

// Client Stats Routes
router.get('/stats', getClientStats);
router.get('/manager-stats', getManagerStats);

// Client Routes
router.get('/', getAllClients);
router.post('/', addClient);

// ✅ FIXED: ID routes - these should come last
router.get('/:id', getClientById);
router.put('/:id', updateClient);
router.patch('/:id/progress', updateClientProgress);
router.patch('/:id/add-manager', addProjectManager);
router.patch('/:id/remove-manager', removeProjectManager);
router.delete('/:id', deleteClient);

module.exports = router;