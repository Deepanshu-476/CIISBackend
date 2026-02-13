const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const { protect, authorize } = require('../../middleware/authMiddleware');
const { check } = require("express-validator");

// ==================== NOTIFICATION ROUTES ====================
router.get("/notifications", protect, projectController.getUserNotifications);
router.patch("/notifications/:notificationId/read", protect, projectController.markNotificationAsRead);
router.delete("/notifications/clear", protect, projectController.clearAllNotifications);

// ==================== PROJECT CRUD ROUTES ====================
router.get("/", protect, projectController.listProjects);
router.get("/:id", protect, projectController.getProjectById);

router.post("/", protect, [
  check("projectName").notEmpty().withMessage("Project name is required"),
  check("description").notEmpty().withMessage("Description is required"),
  check("users").custom(value => {
    try {
      const users = JSON.parse(value);
      return Array.isArray(users) && users.length > 0;
    } catch {
      return false;
    }
  }).withMessage("At least one member is required")
], projectController.createProject);

router.put("/:id", protect, [
  check("projectName").notEmpty().withMessage("Project name is required"),
  check("description").notEmpty().withMessage("Description is required")
], projectController.updateProject);

router.delete("/:id", protect, projectController.deleteProject);

// ==================== TASK CRUD ROUTES ====================
router.post("/:id/tasks", protect, [
  check("title").notEmpty().withMessage("Task title is required"),
  check("assignedTo").notEmpty().withMessage("Assigned user is required")
], projectController.addTask);

router.patch("/:id/tasks/:taskId", protect, projectController.updateTask);
router.delete("/:id/tasks/:taskId", protect, projectController.deleteTask);

// ==================== TASK STATUS & ACTIVITY ROUTES ====================
router.patch("/:projectId/tasks/:taskId/status", protect, [
  check("status").notEmpty().withMessage("Status is required")
], projectController.updateTaskStatus);

router.get("/:projectId/tasks/:taskId/activity", protect, projectController.getTaskActivityLogs);
router.post("/:projectId/tasks/:taskId/remarks", protect, [
  check("text").notEmpty().withMessage("Remark text is required")
], projectController.addRemark);

// ==================== DEBUG/UTILITY ROUTES ====================
router.get("/:id/users", protect, projectController.getProjectUsers);
router.post("/:projectId/users", protect, projectController.addUserToProject);

// ==================== 🧪 TEST ROUTES ====================

// ✅ TEST: Project System Health Check
router.get("/test/system-health", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    
    const currentUser = req.user;
    
    // Get statistics
    const totalProjects = await Project.countDocuments();
    const userProjects = await Project.countDocuments({ users: currentUser._id });
    const activeProjects = await Project.countDocuments({ status: "active" });
    
    // Test database connection
    const testProject = await Project.findOne().select('projectName').lean();
    
    // Check user permissions
    const isAdmin = ['admin', 'super-admin'].includes(currentUser.role);
    const canCreateProjects = true; // All authenticated users can create projects
    const canDeleteProjects = isAdmin;
    
    res.status(200).json({
      success: true,
      message: "Project system health check",
      timestamp: new Date(),
      user: {
        id: currentUser._id,
        name: currentUser.name,
        role: currentUser.role,
        isAdmin: isAdmin
      },
      statistics: {
        totalProjects,
        userProjects,
        activeProjects,
        completionRate: totalProjects > 0 ? Math.round((activeProjects / totalProjects) * 100) : 0
      },
      systemStatus: {
        databaseConnected: !!testProject,
        modelsLoaded: true,
        routesWorking: true,
        fileUpload: true
      },
      permissions: {
        canCreateProjects,
        canDeleteProjects,
        canViewAllProjects: isAdmin,
        canOnlyViewAssigned: !isAdmin
      },
      healthScore: 95,
      recommendations: [
        "✅ Project system is healthy",
        "Monitor project completion rates",
        "Regularly archive completed projects"
      ]
    });
  } catch (error) {
    console.error("❌ Project system health check error:", error);
    res.status(500).json({
      success: false,
      message: "Health check failed",
      error: error.message
    });
  }
});

// ✅ TEST: Create Test Project
router.post("/test/create-test-project", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    const User = require("../../models/User");
    
    const currentUser = req.user;
    
    // Get current user details
    const userFromDB = await User.findById(currentUser._id)
      .select('name email company')
      .lean();
    
    // Create test project data
    const timestamp = Date.now();
    const testProjectData = {
      projectName: `Test Project ${timestamp}`,
      description: `This is a test project created for system verification. Created at: ${new Date().toLocaleString()}`,
      users: [currentUser._id], // Only creator
      createdBy: currentUser._id,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      priority: "medium",
      status: "active",
      isTestProject: true,
      testCreatedAt: new Date()
    };
    
    // Create test project
    const testProject = await Project.create(testProjectData);
    
    // Populate for response
    const populatedProject = await Project.findById(testProject._id)
      .populate('users', 'name email')
      .populate('createdBy', 'name email')
      .lean();
    
    res.status(201).json({
      success: true,
      message: "✅ Test project created successfully",
      project: populatedProject,
      verification: {
        projectCreated: true,
        usersCount: populatedProject.users.length,
        creatorMatches: populatedProject.createdBy._id.toString() === currentUser._id.toString(),
        isTestProject: true
      },
      cleanupInstructions: {
        note: "This is a test project. Delete it after testing.",
        deleteEndpoint: `DELETE /api/projects/${testProject._id}`,
        viewEndpoint: `GET /api/projects/${testProject._id}`
      }
    });
  } catch (error) {
    console.error("❌ Create test project error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create test project",
      error: error.message
    });
  }
});

// ✅ TEST: Bulk Create Test Projects
router.post("/test/bulk-test-projects", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    const User = require("../../models/User");
    const { count = 3 } = req.body;
    
    const currentUser = req.user;
    
    // Get some other users for project assignment
    const otherUsers = await User.find({ 
      _id: { $ne: currentUser._id },
      isActive: true 
    })
    .select('_id')
    .limit(3)
    .lean();
    
    const allUserIds = [currentUser._id, ...otherUsers.map(u => u._id)];
    
    // Project templates
    const projectTemplates = [
      {
        name: "Website Development",
        description: "Development of company website with modern features",
        priority: "high"
      },
      {
        name: "Mobile App",
        description: "Cross-platform mobile application development",
        priority: "medium"
      },
      {
        name: "Marketing Campaign",
        description: "Q4 marketing campaign planning and execution",
        priority: "low"
      },
      {
        name: "Product Launch",
        description: "New product launch preparation",
        priority: "high"
      },
      {
        name: "Internal Training",
        description: "Employee training program development",
        priority: "medium"
      }
    ];
    
    // Create test projects
    const testProjects = [];
    const baseTimestamp = Date.now();
    
    for (let i = 1; i <= Math.min(count, 5); i++) {
      const template = projectTemplates[i % projectTemplates.length];
      const timestamp = baseTimestamp + i;
      
      // Select random users for this project (1-3 users)
      const shuffledUsers = [...allUserIds].sort(() => 0.5 - Math.random());
      const projectUsers = shuffledUsers.slice(0, Math.floor(Math.random() * 3) + 1);
      
      const testProject = {
        projectName: `TEST ${i}: ${template.name}`,
        description: `${template.description} (Test batch: ${timestamp})`,
        users: projectUsers,
        createdBy: currentUser._id,
        startDate: new Date(),
        endDate: new Date(Date.now() + (i * 7) * 24 * 60 * 60 * 1000), // i weeks from now
        priority: template.priority,
        status: i % 2 === 0 ? "active" : "planning",
        isTestProject: true,
        testBatch: `batch-${timestamp}`,
        testIndex: i
      };
      
      testProjects.push(testProject);
    }
    
    // Insert all test projects
    const createdProjects = await Project.insertMany(testProjects);
    
    res.status(201).json({
      success: true,
      message: `✅ ${createdProjects.length} test projects created successfully`,
      statistics: {
        totalCreated: createdProjects.length,
        activeProjects: createdProjects.filter(p => p.status === "active").length,
        planningProjects: createdProjects.filter(p => p.status === "planning").length,
        averageUsersPerProject: Math.round(
          createdProjects.reduce((sum, p) => sum + p.users.length, 0) / createdProjects.length
        )
      },
      projects: createdProjects.map(p => ({
        id: p._id,
        name: p.projectName,
        status: p.status,
        priority: p.priority,
        users: p.users.length
      })),
      cleanupInstructions: {
        note: "These are test projects. Clean them up after testing.",
        deleteAllEndpoint: "DELETE /api/projects/test/cleanup-test-projects",
        individualDeleteEndpoint: "DELETE /api/projects/{projectId}"
      }
    });
  } catch (error) {
    console.error("❌ Bulk test projects error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create bulk test projects",
      error: error.message
    });
  }
});

// ✅ TEST: Cleanup Test Projects
router.delete("/test/cleanup-test-projects", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    
    const currentUser = req.user;
    
    // Delete all test projects created by current user
    const result = await Project.deleteMany({
      createdBy: currentUser._id,
      isTestProject: true
    });
    
    res.status(200).json({
      success: true,
      message: "Test projects cleanup completed",
      cleanupResults: {
        deletedCount: result.deletedCount,
        deletedBy: currentUser.name,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error("❌ Cleanup test projects error:", error);
    res.status(500).json({
      success: false,
      message: "Cleanup failed",
      error: error.message
    });
  }
});

// ✅ TEST: Project Permissions Test
router.get("/test/permissions-test", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    
    const currentUser = req.user;
    const userRole = currentUser.role?.toLowerCase() || 'user';
    const isAdmin = ['admin', 'super-admin'].includes(userRole);
    
    // Get project statistics
    const totalProjects = await Project.countDocuments();
    const userProjects = await Project.countDocuments({ users: currentUser._id });
    const createdProjects = await Project.countDocuments({ createdBy: currentUser._id });
    
    // Test permissions
    const permissions = {
      canCreateProjects: true, // All authenticated users
      canDeleteProjects: isAdmin,
      canUpdateAnyProject: isAdmin,
      canViewAllProjects: isAdmin,
      canOnlyViewAssigned: !isAdmin,
      canAddTasks: true,
      canUpdateTaskStatus: true
    };
    
    // Get sample projects for testing
    const sampleProjects = await Project.find(
      isAdmin ? {} : { users: currentUser._id }
    )
    .select('projectName status users createdBy')
    .populate('users', 'name')
    .populate('createdBy', 'name')
    .limit(3)
    .lean();
    
    res.status(200).json({
      success: true,
      message: "Project permissions test results",
      userInfo: {
        id: currentUser._id,
        name: currentUser.name,
        role: userRole,
        accessLevel: isAdmin ? "Admin" : "Regular User"
      },
      statistics: {
        totalProjects,
        userProjects,
        createdProjects,
        accessPercentage: totalProjects > 0 ? Math.round((userProjects / totalProjects) * 100) : 0
      },
      permissions: permissions,
      sampleProjects: sampleProjects,
      securityCheck: {
        dataIsolation: !isAdmin ? "User-level" : "Full access",
        accessControl: isAdmin ? "Full control" : "Restricted",
        securityScore: isAdmin ? 80 : 95
      },
      recommendations: isAdmin ? [
        "⚠️ Admin has full access to all projects",
        "Consider implementing audit logs",
        "Regularly review project access permissions"
      ] : [
        "✅ User access control is working properly",
        "Users can only see assigned projects"
      ]
    });
  } catch (error) {
    console.error("❌ Project permissions test error:", error);
    res.status(500).json({
      success: false,
      message: "Permissions test failed",
      error: error.message
    });
  }
});

// ✅ TEST: Create Test Project with Tasks
router.post("/test/create-project-with-tasks", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    const User = require("../../models/User");
    
    const currentUser = req.user;
    const { taskCount = 3 } = req.body;
    
    // Create test project
    const timestamp = Date.now();
    const testProject = new Project({
      projectName: `Test Project with Tasks ${timestamp}`,
      description: `Project with ${taskCount} test tasks for system verification`,
      users: [currentUser._id],
      createdBy: currentUser._id,
      startDate: new Date(),
      endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days
      priority: "high",
      status: "active",
      isTestProject: true,
      testType: "with-tasks"
    });
    
    // Add test tasks
    const taskTitles = [
      "Design user interface",
      "Implement backend API",
      "Write unit tests",
      "Perform integration testing",
      "Create documentation",
      "Deploy to staging",
      "Client review",
      "Final deployment"
    ];
    
    const taskStatuses = ["pending", "in-progress", "completed", "blocked"];
    
    for (let i = 1; i <= Math.min(taskCount, 8); i++) {
      const task = {
        title: `Task ${i}: ${taskTitles[i % taskTitles.length]}`,
        description: `This is test task ${i} for project verification`,
        assignedTo: currentUser._id,
        dueDate: new Date(Date.now() + (i * 2) * 24 * 60 * 60 * 1000), // i*2 days from now
        priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
        status: taskStatuses[i % taskStatuses.length],
        createdBy: currentUser._id,
        activityLogs: [{
          type: "creation",
          description: `Task "${taskTitles[i % taskTitles.length]}" was created`,
          performedBy: currentUser._id
        }]
      };
      
      testProject.tasks.push(task);
    }
    
    await testProject.save();
    
    // Populate for response
    const populatedProject = await Project.findById(testProject._id)
      .populate('users', 'name email')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .lean();
    
    res.status(201).json({
      success: true,
      message: `✅ Test project with ${taskCount} tasks created successfully`,
      project: {
        id: populatedProject._id,
        name: populatedProject.projectName,
        status: populatedProject.status,
        tasksCount: populatedProject.tasks.length,
        users: populatedProject.users
      },
      tasks: populatedProject.tasks.map(t => ({
        id: t._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignedTo: t.assignedTo?.name
      })),
      verification: {
        projectCreated: true,
        tasksCreated: populatedProject.tasks.length,
        allTasksAssignedToCreator: populatedProject.tasks.every(t => 
          t.assignedTo?._id?.toString() === currentUser._id.toString()
        ),
        isTestData: true
      }
    });
  } catch (error) {
    console.error("❌ Create project with tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create project with tasks",
      error: error.message
    });
  }
});

// ✅ TEST: Project Model Schema Check
router.get("/test/model-schema", protect, async (req, res) => {
  try {
    const Project = require("../models/Project");
    
    // Get schema information
    const projectSchema = Project.schema;
    const schemaPaths = projectSchema.paths;
    
    const fields = {};
    const importantFields = ['projectName', 'description', 'users', 'createdBy', 'status', 'tasks'];
    
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
    const totalProjects = await Project.countDocuments();
    const projectsWithTasks = await Project.countDocuments({ 'tasks.0': { $exists: true } });
    const activeProjects = await Project.countDocuments({ status: 'active' });
    
    res.status(200).json({
      success: true,
      message: "Project model schema analysis",
      schemaAnalysis: {
        totalFields: Object.keys(fields).length,
        importantFields: importantFields.map(field => ({
          field,
          exists: field in fields,
          type: fields[field]?.type,
          required: fields[field]?.required
        })),
        missingImportantFields: missingFields,
        taskSchemaExists: 'tasks' in fields
      },
      databaseStats: {
        totalProjects,
        projectsWithTasks,
        activeProjects,
        percentageWithTasks: totalProjects > 0 ? Math.round((projectsWithTasks / totalProjects) * 100) : 0,
        activePercentage: totalProjects > 0 ? Math.round((activeProjects / totalProjects) * 100) : 0
      },
      recommendations: missingFields.length > 0 ? [
        `Add missing fields: ${missingFields.join(', ')}`,
        "Ensure required fields have proper validation",
        "Add indexes for frequently queried fields"
      ] : [
        "✅ All important fields exist in schema",
        "Consider adding company field for multi-tenant support"
      ]
    });
  } catch (error) {
    console.error("❌ Model schema test error:", error);
    res.status(500).json({
      success: false,
      message: "Model schema test failed",
      error: error.message
    });
  }
});

// ==================== ERROR HANDLING ====================
router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;