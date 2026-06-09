const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

// Employee support center
router.get("/employee/overview", supportController.getEmployeeOverview);
router.get("/tickets/my", supportController.getMyTickets);
router.post("/tickets", supportController.createTicket);
router.post("/tickets/:id/messages", supportController.replyToMyTicket);
router.post("/chatbot/ask", supportController.askChatbot);
router.get("/departments", supportController.getDepartmentsForSupport);
router.get("/knowledge-base", supportController.getKnowledgeBase);
router.post("/enquiries", supportController.createEnquiry);

// Super admin / support operations
router.get("/admin/dashboard", supportController.getAdminDashboard);
router.get("/admin/departments", supportController.getAdminDepartments);
router.get("/admin/departments/:id/employees", supportController.getDepartmentEmployees);
router.patch("/admin/departments/:id/head", supportController.assignDepartmentHead);
router.get("/admin/tickets", supportController.getAllTickets);
router.patch("/admin/tickets/:id", supportController.updateTicket);
router.get("/admin/enquiries", supportController.getEnquiries);
router.get("/admin/chatbot-logs", supportController.getChatbotLogs);
router.post("/admin/knowledge-base", supportController.createKnowledgeBaseArticle);
router.get("/admin/reports", supportController.getReports);

module.exports = router;
