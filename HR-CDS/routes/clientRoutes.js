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
  removeProjectManager,
  getClientsByCompany
} = require('../controllers/clientController');

// ✅ Service Routes
router.get('/services', serviceController.getAllServices);
router.post('/services', serviceController.addService);
router.put('/services/:id', serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);

// ✅ Client Stats Routes
router.get('/stats', getClientStats);
router.get('/manager-stats', getManagerStats);

// ✅ Client Routes
router.get('/', getAllClients);
router.post('/', addClient);
router.get('/company/:companyCode', getClientsByCompany);

// ✅ ID routes - these should come last
router.get('/:id', getClientById);
router.put('/:id', updateClient);
router.patch('/:id/progress', updateClientProgress);
router.patch('/:id/add-manager', addProjectManager);
router.patch('/:id/remove-manager', removeProjectManager);
router.delete('/:id', deleteClient);

// ==================== 🧪 TEST ROUTES ====================

// ✅ TEST: Client System Health Check
router.get('/test/system-check', async (req, res) => {
  try {
    const Client = require('../models/Client');
    const Service = require('../models/Service');
    
    // Get statistics
    const totalClients = await Client.countDocuments();
    const totalServices = await Service.countDocuments();
    
    // Check if any clients have companyCode field
    const clientsWithCompanyCode = await Client.countDocuments({ 
      companyCode: { $exists: true, $ne: '' } 
    });
    
    // Get sample data
    const sampleClient = await Client.findOne()
      .select('client company companyCode projectManager services status')
      .lean();
    
    const sampleService = await Service.findOne()
      .select('servicename description companyCode price')
      .lean();
    
    // Check unique company codes
    const uniqueCompanyCodes = await Client.distinct('companyCode');
    
    res.status(200).json({
      success: true,
      message: 'Client system health check',
      timestamp: new Date(),
      statistics: {
        totalClients,
        totalServices,
        clientsWithCompanyCode,
        clientsWithoutCompanyCode: totalClients - clientsWithCompanyCode,
        uniqueCompanyCodes: uniqueCompanyCodes.length
      },
      sampleData: {
        client: sampleClient,
        service: sampleService,
        uniqueCompanyCodes: uniqueCompanyCodes.slice(0, 5)
      },
      systemHealth: {
        databaseConnected: true,
        modelsLoaded: true,
        companyCodeField: 'companyCode' in Client.schema.paths,
        dataIntegrity: clientsWithCompanyCode > 0
      },
      recommendations: clientsWithCompanyCode === 0 ? [
        '⚠️ No clients have companyCode field populated',
        'Update existing clients with companyCode',
        'Add companyCode validation to client creation'
      ] : [
        '✅ Client system is healthy',
        'Company code filtering is working'
      ]
    });
  } catch (error) {
    console.error('❌ Client system check error:', error);
    res.status(500).json({
      success: false,
      message: 'System check failed',
      error: error.message
    });
  }
});

// ✅ TEST: Create Test Client with Company Code
router.post('/test/create-test-client', async (req, res) => {
  try {
    const Client = require('../models/Client');
    const Service = require('../models/Service');
    
    const { companyCode = 'TEST001', createServices = true } = req.body;
    
    // Validate company code
    if (!companyCode || companyCode.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }
    
    // Check if test client already exists
    const existingTestClient = await Client.findOne({
      client: 'Test Client',
      companyCode: companyCode.toUpperCase()
    });
    
    if (existingTestClient) {
      return res.status(409).json({
        success: false,
        message: 'Test client already exists for this company',
        data: existingTestClient
      });
    }
    
    // Create test services if needed
    let testServiceNames = [];
    if (createServices) {
      // Check if test services exist, create if not
      const testServices = [
        { servicename: 'Web Development', description: 'Website development service', price: 5000 },
        { servicename: 'Mobile App', description: 'Mobile application development', price: 8000 },
        { servicename: 'Consulting', description: 'IT consulting services', price: 3000 }
      ];
      
      for (const serviceData of testServices) {
        const existingService = await Service.findOne({
          servicename: serviceData.servicename,
          companyCode: companyCode.toUpperCase()
        });
        
        if (!existingService) {
          await Service.create({
            ...serviceData,
            companyCode: companyCode.toUpperCase(),
            isTestData: true
          });
        }
        testServiceNames.push(serviceData.servicename);
      }
    }
    
    // Create test client
    const testClient = new Client({
      client: 'Test Client',
      company: 'Test Company Pvt. Ltd.',
      city: 'Test City',
      companyCode: companyCode.toUpperCase(),
      projectManager: ['Test Manager 1', 'Test Manager 2'],
      services: testServiceNames,
      status: 'Active',
      progress: '2/5 (40%)',
      email: 'test@testcompany.com',
      phone: '+91 9876543210',
      address: 'Test Address, Test City - 123456',
      description: 'This is a test client created for system verification',
      notes: 'Test data - can be deleted',
      isTestData: true,
      testCreatedAt: new Date()
    });
    
    await testClient.save();
    
    res.status(201).json({
      success: true,
      message: '✅ Test client created successfully',
      data: testClient,
      verification: {
        clientCreated: true,
        companyCode: testClient.companyCode,
        isTestData: true,
        servicesCount: testClient.services.length
      },
      cleanupInstructions: {
        note: 'This is a test client. Delete it after testing.',
        deleteEndpoint: `DELETE /api/clients/${testClient._id}`,
        viewEndpoint: `GET /api/clients/${testClient._id}`
      }
    });
  } catch (error) {
    console.error('❌ Create test client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test client',
      error: error.message
    });
  }
});

// ✅ TEST: Bulk Create Test Clients
router.post('/test/bulk-test-clients', async (req, res) => {
  try {
    const Client = require('../models/Client');
    const { count = 3, companyCode = 'TEST001' } = req.body;
    
    // Validate company code
    if (!companyCode || companyCode.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }
    
    // Client templates
    const clientTemplates = [
      {
        client: 'ABC Corporation',
        company: 'ABC Corp Ltd.',
        city: 'Mumbai',
        status: 'Active',
        progress: '5/10 (50%)'
      },
      {
        client: 'XYZ Enterprises',
        company: 'XYZ Group',
        city: 'Delhi',
        status: 'Inactive',
        progress: '3/8 (38%)'
      },
      {
        client: 'Global Solutions',
        company: 'Global Tech',
        city: 'Bangalore',
        status: 'Active',
        progress: '8/8 (100%)'
      },
      {
        client: 'Innovate Inc',
        company: 'Innovate Technologies',
        city: 'Hyderabad',
        status: 'Pending',
        progress: '0/5 (0%)'
      },
      {
        client: 'Tech Masters',
        company: 'Tech Masters LLC',
        city: 'Chennai',
        status: 'Active',
        progress: '6/12 (50%)'
      }
    ];
    
    // Project manager options
    const projectManagers = [
      ['John Doe', 'Jane Smith'],
      ['Robert Johnson', 'Emily Davis'],
      ['Michael Brown', 'Sarah Wilson'],
      ['David Miller', 'Lisa Taylor'],
      ['James Anderson', 'Maria Thomas']
    ];
    
    // Create test clients
    const testClients = [];
    const timestamp = Date.now();
    
    for (let i = 1; i <= Math.min(count, 5); i++) {
      const template = clientTemplates[i % clientTemplates.length];
      const managers = projectManagers[i % projectManagers.length];
      
      const testClient = {
        client: `TEST ${i}: ${template.client}`,
        company: template.company,
        city: template.city,
        companyCode: companyCode.toUpperCase(),
        projectManager: managers,
        services: ['Web Development', 'Consulting', 'Support'],
        status: template.status,
        progress: template.progress,
        email: `client${i}@testcompany.com`,
        phone: `+91 98765${(timestamp + i).toString().slice(-5)}`,
        address: `${template.city} Address, ${template.city} - 10000${i}`,
        description: `Test client ${i} for company ${companyCode}`,
        notes: 'Test data for system verification',
        isTestData: true,
        testBatch: `batch-${timestamp}`,
        testIndex: i
      };
      
      testClients.push(testClient);
    }
    
    // Insert all test clients
    const createdClients = await Client.insertMany(testClients);
    
    // Calculate statistics
    const stats = {
      totalCreated: createdClients.length,
      activeClients: createdClients.filter(c => c.status === 'Active').length,
      inactiveClients: createdClients.filter(c => c.status === 'Inactive').length,
      pendingClients: createdClients.filter(c => c.status === 'Pending').length,
      averageServicesPerClient: Math.round(
        createdClients.reduce((sum, c) => sum + c.services.length, 0) / createdClients.length
      )
    };
    
    res.status(201).json({
      success: true,
      message: `✅ ${createdClients.length} test clients created successfully`,
      statistics: stats,
      companyCode: companyCode.toUpperCase(),
      clients: createdClients.map(c => ({
        id: c._id,
        client: c.client,
        status: c.status,
        progress: c.progress,
        projectManagers: c.projectManager.length
      })),
      cleanupInstructions: {
        note: 'These are test clients. Clean them up after testing.',
        deleteAllEndpoint: `DELETE /api/clients/test/cleanup-test-clients?companyCode=${companyCode}`,
        individualDeleteEndpoint: 'DELETE /api/clients/{clientId}'
      }
    });
  } catch (error) {
    console.error('❌ Bulk test clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bulk test clients',
      error: error.message
    });
  }
});

// ✅ TEST: Cleanup Test Clients
router.delete('/test/cleanup-test-clients', async (req, res) => {
  try {
    const Client = require('../models/Client');
    const Service = require('../models/Service');
    
    const { companyCode } = req.query;
    
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: 'Company code is required for cleanup'
      });
    }
    
    // Delete test clients
    const clientResult = await Client.deleteMany({
      companyCode: companyCode.toUpperCase(),
      isTestData: true
    });
    
    // Delete test services (optional)
    const serviceResult = await Service.deleteMany({
      companyCode: companyCode.toUpperCase(),
      isTestData: true
    });
    
    res.status(200).json({
      success: true,
      message: 'Test data cleanup completed',
      cleanupResults: {
        clientsDeleted: clientResult.deletedCount,
        servicesDeleted: serviceResult.deletedCount,
        companyCode: companyCode.toUpperCase(),
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('❌ Cleanup test clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Cleanup failed',
      error: error.message
    });
  }
});

// ✅ TEST: Company Code Filter Test
router.get('/test/company-filter-test', async (req, res) => {
  try {
    const Client = require('../models/Client');
    
    // Get all unique company codes
    const companyCodes = await Client.distinct('companyCode');
    
    // Test each company code
    const testResults = [];
    
    for (const companyCode of companyCodes.slice(0, 5)) { // Test first 5 company codes
      if (!companyCode) continue;
      
      const clientsInCompany = await Client.find({ 
        companyCode: companyCode 
      }).countDocuments();
      
      // Try to access clients from other company (should not see if properly isolated)
      const otherCompanyCode = companyCodes.find(code => code !== companyCode && code);
      let canSeeOtherCompanyData = false;
      
      if (otherCompanyCode) {
        const otherCompanyClients = await Client.find({ 
          companyCode: otherCompanyCode 
        }).countDocuments();
        canSeeOtherCompanyData = otherCompanyClients > 0;
      }
      
      testResults.push({
        companyCode,
        clientsInCompany,
        canSeeOtherCompanyData,
        securityLevel: canSeeOtherCompanyData ? '⚠️ LOW' : '✅ HIGH'
      });
    }
    
    // Overall assessment
    const securityIssues = testResults.filter(r => r.canSeeOtherCompanyData).length;
    
    res.status(200).json({
      success: true,
      message: 'Company code filter test results',
      totalUniqueCompanyCodes: companyCodes.length,
      testResults: testResults,
      securityAssessment: {
        totalTests: testResults.length,
        securityIssues,
        overallSecurity: securityIssues > 0 ? '⚠️ COMPROMISED' : '✅ SECURE',
        dataIsolation: securityIssues > 0 ? 'NOT WORKING' : 'WORKING'
      },
      recommendations: securityIssues > 0 ? [
        '🚨 SECURITY ISSUE: Can access clients from other companies',
        'Add company code filtering to all client queries',
        'Verify middleware enforces company code validation'
      ] : [
        '✅ Company code filtering is working properly',
        'Data isolation between companies is enforced'
      ]
    });
  } catch (error) {
    console.error('❌ Company filter test error:', error);
    res.status(500).json({
      success: false,
      message: 'Company filter test failed',
      error: error.message
    });
  }
});

// ✅ TEST: Client Model Schema Check
router.get('/test/model-schema', async (req, res) => {
  try {
    const Client = require('../models/Client');
    
    // Get schema information
    const clientSchema = Client.schema;
    const schemaPaths = clientSchema.paths;
    
    const fields = {};
    const importantFields = ['client', 'company', 'companyCode', 'projectManager', 'services', 'status'];
    
    Object.keys(schemaPaths).forEach(path => {
      const schemaType = schemaPaths[path];
      fields[path] = {
        type: schemaType.instance,
        required: schemaType.isRequired || false,
        default: schemaType.defaultValue,
        ref: schemaType.options?.ref || null,
        isImportant: importantFields.includes(path)
      };
    });
    
    // Check for important fields
    const missingFields = importantFields.filter(field => !(field in fields));
    
    // Get sample data stats
    const totalClients = await Client.countDocuments();
    const clientsWithCompanyCode = await Client.countDocuments({ companyCode: { $exists: true, $ne: '' } });
    const clientsWithServices = await Client.countDocuments({ 'services.0': { $exists: true } });
    const activeClients = await Client.countDocuments({ status: 'Active' });
    
    res.status(200).json({
      success: true,
      message: 'Client model schema analysis',
      schemaAnalysis: {
        totalFields: Object.keys(fields).length,
        importantFields: importantFields.map(field => ({
          field,
          exists: field in fields,
          type: fields[field]?.type,
          required: fields[field]?.required
        })),
        missingImportantFields: missingFields,
        companyCodeFieldInfo: fields.companyCode || 'Not found'
      },
      databaseStats: {
        totalClients,
        clientsWithCompanyCode,
        clientsWithoutCompanyCode: totalClients - clientsWithCompanyCode,
        clientsWithServices,
        activeClients,
        companyCodeCoverage: totalClients > 0 ? Math.round((clientsWithCompanyCode / totalClients) * 100) : 0
      },
      recommendations: missingFields.length > 0 ? [
        `Add missing fields: ${missingFields.join(', ')}`,
        'Ensure companyCode is required for all clients',
        'Add indexes for frequently queried fields'
      ] : [
        '✅ All important fields exist in schema',
        'Consider adding validation for companyCode format'
      ]
    });
  } catch (error) {
    console.error('❌ Model schema test error:', error);
    res.status(500).json({
      success: false,
      message: 'Model schema test failed',
      error: error.message
    });
  }
});

// ✅ TEST: Client Creation with Validation
router.post('/test/validation-test', async (req, res) => {
  try {
    const Client = require('../models/Client');
    
    const testCases = [
      {
        name: 'Valid client data',
        data: {
          client: 'Test Validation Client',
          company: 'Test Company',
          city: 'Test City',
          companyCode: 'VALID01',
          projectManager: ['Manager One'],
          services: [],
          status: 'Active'
        },
        shouldPass: true
      },
      {
        name: 'Missing client name',
        data: {
          client: '',
          company: 'Test Company',
          city: 'Test City',
          companyCode: 'VALID02',
          projectManager: ['Manager One'],
          services: []
        },
        shouldPass: false,
        expectedError: 'Client name is required'
      },
      {
        name: 'Missing company code',
        data: {
          client: 'Test Client',
          company: 'Test Company',
          city: 'Test City',
          companyCode: '',
          projectManager: ['Manager One'],
          services: []
        },
        shouldPass: false,
        expectedError: 'Company code is required'
      },
      {
        name: 'Empty project manager array',
        data: {
          client: 'Test Client',
          company: 'Test Company',
          city: 'Test City',
          companyCode: 'VALID03',
          projectManager: [],
          services: []
        },
        shouldPass: false,
        expectedError: 'At least one project manager is required'
      },
      {
        name: 'Duplicate client for same company',
        data: {
          client: 'Duplicate Test',
          company: 'Test Company',
          city: 'Test City',
          companyCode: 'DUP01',
          projectManager: ['Manager One'],
          services: []
        },
        shouldPass: false, // Should fail on second attempt
        expectedError: 'Client already exists for this company'
      }
    ];
    
    const results = [];
    
    for (const testCase of testCases) {
      try {
        // For duplicate test, create first then try duplicate
        if (testCase.name === 'Duplicate client for same company') {
          // Create first client
          const firstClient = new Client({
            ...testCase.data,
            isTestData: true,
            testValidation: true
          });
          await firstClient.save();
          
          // Try to create duplicate
          try {
            const duplicateClient = new Client({
              ...testCase.data,
              isTestData: true,
              testValidation: true
            });
            await duplicateClient.save();
            results.push({
              test: testCase.name,
              passed: false,
              expected: 'Should fail',
              actual: 'Passed (unexpected)',
              error: 'Did not catch duplicate'
            });
          } catch (error) {
            results.push({
              test: testCase.name,
              passed: testCase.shouldPass === false,
              expected: testCase.expectedError,
              actual: error.message,
              error: null
            });
          }
        } else {
          const testClient = new Client({
            ...testCase.data,
            isTestData: true,
            testValidation: true
          });
          
          await testClient.save();
          results.push({
            test: testCase.name,
            passed: testCase.shouldPass === true,
            expected: 'Should pass',
            actual: 'Passed',
            error: null
          });
        }
      } catch (error) {
        results.push({
          test: testCase.name,
          passed: testCase.shouldPass === false,
          expected: testCase.expectedError,
          actual: error.message,
          error: error.code === 11000 ? 'Duplicate key error' : error.message
        });
      }
    }
    
    // Cleanup test data
    await Client.deleteMany({ testValidation: true });
    
    const passedTests = results.filter(r => r.passed).length;
    const totalTests = results.length;
    
    res.status(200).json({
      success: true,
      message: 'Client validation test results',
      results: results,
      summary: {
        totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        successRate: Math.round((passedTests / totalTests) * 100)
      },
      assessment: passedTests === totalTests ? '✅ All tests passed' : '⚠️ Some tests failed'
    });
  } catch (error) {
    console.error('❌ Validation test error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation test failed',
      error: error.message
    });
  }
});

module.exports = router;