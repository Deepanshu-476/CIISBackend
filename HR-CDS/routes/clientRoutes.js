const express = require('express');
const router = express.Router();
const auth = require('../../middleware/authMiddleware');

const serviceController = require('../controllers/services');
const clientController = require('../controllers/clientController');

// Service Routes
router.get('/services', serviceController.getAllServices);
router.post('/services', serviceController.addService);
// router.get('/services/popular', serviceController.getPopularServices);
router.put('/services/:id', serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);

// Client Routes
router.get('/clients', clientController.getAllClients);
router.get('/clients/stats', clientController.getClientStats);
router.get('/clients/:id', clientController.getClientById);
router.post('/clients', clientController.addClient);
router.put('/clients/:id', clientController.updateClient);
router.patch('/clients/:id/progress', clientController.updateClientProgress);
router.delete('/clients/:id', clientController.deleteClient);

module.exports = router;