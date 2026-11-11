const express = require('express');
const router = express.Router();
const auth = require('../../middleware/authMiddleware');
const path = require('path');
const fs = require('fs');
const {resolveReceiptFile} = require('../utils/receiptFile');

const serviceController = require('../controllers/services');
const serviceEnquiryController = require('../controllers/serviceEnquiryController');
const {
  getAllClients,
  getClientById,
  getClientCompanies,
  getCompanyById,
  addClient,
  addClientCompany,
  updateClient,
  updateCompany,
  updateClientProgress,
  deleteClient,
  deleteCompany,
  getClientStats,
  getManagerStats,
  addProjectManager,
  removeProjectManager,
  getClientsByCompany,
  extendClientSubscription,
  renewClientSubscription,
  removeClientSubscription,
  addClientDueInvoice,
  uploadClientReceipt,
  updateClientReceiptStatus,
  markClientReceiptPaymentDone,
  deleteClientReceipt,
  getClientDashboardOverview,
  getClientDashboardStats
} = require('../controllers/clientController');

const multer = require('multer');
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/receipts');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `receipt_${Date.now()}_${path.basename(file.originalname)}`);
  }
});
const uploadReceipt = multer({
  storage: receiptStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});


// Public enquiry creation for landing page leads
router.post('/service-enquiries', serviceEnquiryController.createServiceEnquiry);

// All client management, service management, and client portal routes require authentication
router.use(auth.protect);

const { requirePageAccess } = require('../../middleware/pageAccess');
// Owner and company admin always; anyone else needs the "Client Services" page in Page Management.
const SERVICE_PAGES = ['/ciisUser/client-services'];
const canEditServices = requirePageAccess({ paths: SERVICE_PAGES, action: 'edit', alwaysRoles: ['admin'], label: 'Client Services' });
const canDeleteServices = requirePageAccess({ paths: SERVICE_PAGES, action: 'delete', alwaysRoles: ['admin'], label: 'Client Services' });

router.get('/services', serviceController.getAllServices);
router.post('/services', canEditServices, serviceController.addService);
router.put('/services/:id', canEditServices, serviceController.updateService);
router.delete('/services/:id', canDeleteServices, serviceController.deleteService);

router.get('/service-enquiries', serviceEnquiryController.getServiceEnquiries);
router.patch('/service-enquiries/:id/status', serviceEnquiryController.updateServiceEnquiryStatus);

router.get('/stats', getClientStats);
router.get('/manager-stats', getManagerStats);
router.get('/dashboard-overview', getClientDashboardOverview);
router.get('/dashboard-stats/:clientId', getClientDashboardStats);


router.get('/company/:companyCode', getClientsByCompany);
router.get('/', getAllClients);
router.post('/', addClient);
router.post('/:clientId/companies', addClientCompany);
router.get('/:clientId/companies', getClientCompanies);
router.get('/companies/:companyId', getCompanyById);
router.put('/companies/:companyId', updateCompany);
router.delete('/companies/:companyId', deleteCompany);


router.post('/:id/extend-subscription', extendClientSubscription);
router.patch('/renew-subscription/:id', renewClientSubscription);
router.delete('/subscription/:id', removeClientSubscription);
router.post('/due-invoice/:id', addClientDueInvoice);
router.post('/upload-receipt/:id', uploadReceipt.single('receipt'), uploadClientReceipt);
router.patch('/:id/receipt/:receiptId/payment-done', markClientReceiptPaymentDone);
router.patch('/:id/receipt/:receiptId/status', updateClientReceiptStatus);
router.delete('/:id/receipt/:receiptId', deleteClientReceipt);


router.get('/receipt-image/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    
    const imagePath = resolveReceiptFile(filename);
    
    
    if (imagePath) {
      
      res.sendFile(imagePath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).json({
            success: false,
            message: 'Error serving image'
          });
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Receipt image not found'
      });
    }
  } catch (error) {
    console.error('Error serving receipt image:', error);
    res.status(500).json({
      success: false,
      message: 'Error serving image'
    });
  }
});


router.get('/client/:clientId/receipt/:receiptId', async (req, res) => {
  try {
    const { clientId, receiptId } = req.params;
    const Client = require('../models/Client');
    
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }
    
    const receipt = client.paymentReceipts.id(receiptId);
    if (!receipt || !receipt.receiptImage) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found'
      });
    }
    
    const fullPath = resolveReceiptFile(receipt.receiptImage);
    
    if (fullPath) {
      res.sendFile(fullPath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).json({
            success: false,
            message: 'Error serving image'
          });
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Receipt image file not found'
      });
    }
  } catch (error) {
    console.error('Error serving receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Error serving receipt'
    });
  }
});





router.get('/:id', getClientById);
router.put('/:id', updateClient);
router.patch('/:id/progress', updateClientProgress);
router.patch('/:id/add-manager', addProjectManager);
router.patch('/:id/remove-manager', removeProjectManager);
router.delete('/:id', deleteClient);

module.exports = router;
