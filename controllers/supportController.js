const mongoose = require("mongoose");
const SupportTicket = require("../models/SupportTicket");
const SupportEnquiry = require("../models/SupportEnquiry");
const ChatbotLog = require("../models/ChatbotLog");
const KnowledgeBaseArticle = require("../models/KnowledgeBaseArticle");
const User = require("../models/User");
const Department = require("../models/Department");
const { notifyDirectUsers, notifyPageUsers } = require("../HR-CDS/utils/systemNotificationService");
const { getPaginationOptions, buildPaginationMeta } = require("../utils/pagination");

const getId = value => {
  if (!value) return null;
  if (typeof value === "object") return value._id || value.id || null;
  return value;
};

const getCompanyFilter = req => ({
  companyCode: req.user.companyCode,
});

const getCompanyId = req => getId(req.user.company) || getId(req.user.companyDetails);

const isSupportAdmin = user => {
  const role = String(user?.role || user?.jobRole || user?.companyRole || "").toLowerCase();
  const department = String(user?.departmentName || user?.department || "").toLowerCase();
  return role !== "user" && role !== "employee" || department === "management";
};

const isCompanyOwner = user => String(user?.companyRole || user?.role || "").toLowerCase() === "owner";

const getDepartmentName = department => department?.name || department?.departmentName || department?.title || "General";
const getEntityId = value => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || value.name || "");
  return String(value);
};

const getUserCompanyQuery = req => {
  const query = { isActive: true, companyRole: { $not: /^client$/i } };
  const company = getCompanyId(req);
  if (company) query.company = company;
  else query.companyCode = req.user.companyCode;
  return query;
};

const getDepartmentQuery = req => {
  const query = { isActive: true };
  const company = getCompanyId(req);
  if (company) query.company = company;
  else query.companyCode = req.user.companyCode;
  return query;
};

const isDepartmentHead = async req => {
  const count = await Department.countDocuments({
    ...getDepartmentQuery(req),
    supportHead: req.user._id,
  });
  return count > 0;
};

const requireSupportAccess = async (req, res) => {
  if (isSupportAdmin(req.user)) return { allowed: true, admin: true };
  if (await isDepartmentHead(req)) return { allowed: true, admin: false };
  res.status(403).json({ success: false, message: "Support admin access required" });
  return { allowed: false, admin: false };
};

const getManagedTicketFilter = async (req, baseFilter = {}) => {
  if (isSupportAdmin(req.user)) return baseFilter;
  const departments = await Department.find({
    ...getDepartmentQuery(req),
    supportHead: req.user._id,
  }).select("_id name");
  const departmentIds = departments.map(dept => dept._id);
  const departmentNames = departments.map(getDepartmentName);

  return {
    ...baseFilter,
    $or: [
      { assignedTo: req.user._id },
      { departmentId: { $in: departmentIds } },
      { department: { $in: departmentNames } },
    ],
  };
};

const getSupportDepartments = async req => {
  const departments = await Department.find(getDepartmentQuery(req))
    .select("_id name description company companyCode supportHead supportHeadName branch branchCode isActive")
    .populate("supportHead", "name email jobRole department")
    .sort({ name: 1 })
    .lean();

  return departments.map(department => ({
    id: department._id,
    name: getDepartmentName(department),
    description: department.description,
    supportHead: department.supportHead ? {
      id: department.supportHead._id,
      name: department.supportHead.name,
      email: department.supportHead.email,
      jobRole: department.supportHead.jobRole,
    } : null,
    supportHeadName: department.supportHeadName || department.supportHead?.name || "Unassigned",
  }));
};

const getDepartmentEmployees = async (req, department) => {
  const departmentName = getDepartmentName(department);
  const departmentId = getEntityId(department?._id || department?.id);
  const departmentTerms = [...new Set([departmentId, departmentName].filter(Boolean))];
  const users = await User.find({
    ...getUserCompanyQuery(req),
    department: { $in: departmentTerms },
  })
    .select("name email jobRole companyRole employeeId department")
    .sort({ name: 1 })
    .lean();

  return users.map(user => ({
    id: user._id,
    name: user.name,
    email: user.email,
    jobRole: user.jobRole,
    companyRole: user.companyRole,
    employeeId: user.employeeId,
    department: user.department,
  }));
};

const getVirtualDepartmentsFromUsers = async req => {
  const users = await User.find(getUserCompanyQuery(req)).select("department").lean();
  const departmentMap = new Map();

  users.forEach(user => {
    const id = getEntityId(user.department);
    const name = typeof user.department === "object"
      ? getDepartmentName(user.department)
      : String(user.department || "").trim();
    if (!id || !name) return;
    departmentMap.set(id, { id, _id: id, name, virtual: true });
  });

  return [...departmentMap.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const getTicketAge = ticket => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const getChatbotAnswer = question => {
  const text = String(question || "").toLowerCase();
  if (text.includes("payroll") || text.includes("salary") || text.includes("payslip")) {
    return {
      intent: "Payroll deduction",
      confidence: 94,
      outcome: "Article served",
      answer: "Payroll and payslip queries are available in the Payroll knowledge base. If your amount is mismatched, create a Payroll ticket with payslip month and issue details.",
    };
  }
  if (text.includes("attendance") || text.includes("regularization") || text.includes("clock")) {
    return {
      intent: "Attendance regularization",
      confidence: 91,
      outcome: "Article served",
      answer: "For attendance regularization, open Attendance, select the date, add reason, and submit it for manager approval.",
    };
  }
  if (text.includes("asset") || text.includes("laptop") || text.includes("repair")) {
    return {
      intent: "Asset repair",
      confidence: 88,
      outcome: "Ticket created",
      answer: "For asset repair, raise a ticket under Assets with device name, issue, and urgency. The assets team will update repair status in the ticket.",
    };
  }
  if (text.includes("leave") || text.includes("policy")) {
    return {
      intent: "HR policy",
      confidence: 86,
      outcome: "Resolved",
      answer: "Leave and policy details are available in the knowledge base. For exceptions, create an HR Policy ticket so HR can review it.",
    };
  }
  return {
    intent: "General Support",
    confidence: 78,
    outcome: "Agent handoff",
    answer: "I can help with HR, IT, payroll, attendance, and asset questions. Please share a few more details or create a ticket for agent support.",
  };
};

const seedDefaultArticles = async req => {
  const count = await KnowledgeBaseArticle.countDocuments(getCompanyFilter(req));
  if (count > 0) return;

  const company = getCompanyId(req);
  const defaults = [
    ["Reset attendance regularization", "Attendance", "How to submit or correct attendance regularization requests."],
    ["Submit asset repair request", "Assets", "Steps to raise repair tickets for laptops, phones, and accessories."],
    ["Payroll and reimbursement FAQs", "Payroll", "Common salary, payslip, deduction, and reimbursement answers."],
    ["Remote work approval workflow", "Policy", "How to request remote work and track approval status."],
  ];

  await KnowledgeBaseArticle.insertMany(defaults.map(([title, category, summary], index) => ({
    company,
    companyCode: req.user.companyCode,
    title,
    category,
    summary,
    content: summary,
    views: [2400, 1800, 3100, 980][index],
    createdBy: req.user._id,
  })));
};

const serializeTicket = ticket => ({
  id: ticket._id,
  ticketNumber: ticket.ticketNumber,
  subject: ticket.subject,
  description: ticket.description,
  category: ticket.category,
  status: ticket.status,
  priority: ticket.priority,
  requesterName: ticket.requesterName || ticket.requester?.name,
  requesterEmail: ticket.requesterEmail || ticket.requester?.email,
  departmentId: ticket.departmentId,
  department: ticket.department,
  assignedToName: ticket.assignedToName || ticket.assignedTo?.name || "Unassigned",
  age: getTicketAge(ticket),
  updated: ticket.updatedAt,
  createdAt: ticket.createdAt,
  slaDueAt: ticket.slaDueAt,
  messages: ticket.messages || [],
});

exports.createTicket = async (req, res) => {
  try {
    const { subject, description, category, priority, source, departmentId } = req.body;
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ success: false, message: "Ticket subject is required" });
    }

    let selectedDepartment = null;
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      selectedDepartment = await Department.findOne({
        _id: departmentId,
        ...getDepartmentQuery(req),
      }).populate("supportHead", "name email");
    }

    const ticket = await SupportTicket.create({
      company: getCompanyId(req),
      companyCode: req.user.companyCode,
      requester: req.user._id,
      requesterName: req.user.name,
      requesterEmail: req.user.email,
      departmentId: selectedDepartment?._id,
      department: selectedDepartment ? getDepartmentName(selectedDepartment) : req.user.departmentName || req.user.department || "General",
      subject,
      description,
      category: category || "General",
      priority: priority || "Medium",
      source: source || "portal",
      status: selectedDepartment ? "Waiting" : "Open",
      assignedTo: selectedDepartment?.supportHead?._id,
      assignedToName: selectedDepartment?.supportHead?.name || selectedDepartment?.supportHeadName,
      messages: description ? [{
        sender: req.user._id,
        senderName: req.user.name,
        senderRole: "employee",
        message: description,
      }] : [],
    });

    try {
      if (selectedDepartment?.supportHead?._id) {
        await notifyDirectUsers({
          userIds: [selectedDepartment.supportHead._id],
          targetPath: "/ciisUser/support-desk",
          type: "support_ticket_created",
          title: "New Department Support Query",
          message: `${req.user.name} needs help from ${getDepartmentName(selectedDepartment)}: ${ticket.subject}`,
          actor: req.user._id,
          company: getCompanyId(req),
          data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber, departmentId: selectedDepartment._id },
          priority: ticket.priority === "Critical" ? "high" : "medium",
        });
      } else {
        await notifyPageUsers({
        companyId: getCompanyId(req),
        targetPath: "/ciisUser/contact-support",
        excludeUserIds: [req.user._id],
        type: "support_ticket_created",
        title: "New Support Ticket",
        message: `${req.user.name} created ${ticket.ticketNumber}: ${ticket.subject}`,
        actor: req.user._id,
        data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
        priority: ticket.priority === "Critical" ? "high" : "medium",
      });
      }
    } catch (error) {
      console.error("Support ticket notification failed:", error.message);
    }

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      ticket: serializeTicket(ticket),
    });
  } catch (error) {
    console.error("Create support ticket error:", error);
    res.status(500).json({ success: false, message: "Failed to create support ticket" });
  }
};

exports.getMyTickets = async (req, res) => {
  try {
    const { status, category, q } = req.query;
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const filter = {
      ...getCompanyFilter(req),
      requester: req.user._id,
    };
    if (status && status !== "All") filter.status = status;
    if (category && category !== "All") filter.category = category;
    if (q) filter.$or = [
      { subject: new RegExp(q, "i") },
      { ticketNumber: new RegExp(q, "i") },
      { category: new RegExp(q, "i") },
    ];

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .select("ticketNumber company companyCode requester requesterName requesterEmail departmentId department subject description category source status priority assignedTo assignedToName slaDueAt resolvedAt lastResponseAt satisfactionScore tags messages createdAt updatedAt")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter)
    ]);
    res.json({ success: true, tickets: tickets.map(serializeTicket), count: tickets.length, total, pagination: buildPaginationMeta({ page, limit, total }) });
  } catch (error) {
    console.error("Get my support tickets error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch tickets" });
  }
};

exports.replyToMyTicket = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "Reply message is required" });
    }

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      ...getCompanyFilter(req),
      requester: req.user._id,
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    ticket.messages.push({
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: "employee",
      message,
    });

    if (["Resolved", "Closed"].includes(ticket.status)) {
      ticket.status = "Open";
      ticket.resolvedAt = undefined;
    } else if (ticket.status === "Waiting") {
      ticket.status = "In Progress";
    }

    await ticket.save();

    try {
      if (ticket.assignedTo) {
        await notifyDirectUsers({
          userIds: [ticket.assignedTo],
          targetPath: "/ciisUser/support-desk",
          type: "support_ticket_user_reply",
          title: "New User Reply",
          message: `${req.user.name} replied on ${ticket.ticketNumber}`,
          actor: req.user._id,
          company: getCompanyId(req),
          data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
          priority: ticket.priority === "Critical" ? "high" : "medium",
        });
      }
    } catch (error) {
      console.error("Support user reply notification failed:", error.message);
    }

    res.json({ success: true, message: "Reply sent", ticket: serializeTicket(ticket) });
  } catch (error) {
    console.error("Reply to support ticket error:", error);
    res.status(500).json({ success: false, message: "Failed to send reply" });
  }
};

exports.getAllTickets = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    const { status, category, priority, q } = req.query;
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const filter = await getManagedTicketFilter(req, getCompanyFilter(req));
    if (status && status !== "All") filter.status = status;
    if (category && category !== "All") filter.category = category;
    if (priority && priority !== "All") filter.priority = priority;
    if (q) filter.$or = [
      { subject: new RegExp(q, "i") },
      { ticketNumber: new RegExp(q, "i") },
      { requesterName: new RegExp(q, "i") },
      { requesterEmail: new RegExp(q, "i") },
      { category: new RegExp(q, "i") },
    ];

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
      .select("ticketNumber company companyCode requester requesterName requesterEmail departmentId department subject description category source status priority assignedTo assignedToName slaDueAt resolvedAt lastResponseAt satisfactionScore tags messages createdAt updatedAt")
      .populate("requester", "name email department")
      .populate("assignedTo", "name email")
      .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter)
    ]);

    res.json({
      success: true,
      tickets: tickets.map(serializeTicket),
      count: tickets.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
    });
  } catch (error) {
    console.error("Get all support tickets error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch support tickets" });
  }
};

exports.updateTicket = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    const { status, priority, assignedTo, message } = req.body;
    const ticketFilter = await getManagedTicketFilter(req, {
      _id: req.params.id,
      ...getCompanyFilter(req),
    });
    const ticket = await SupportTicket.findOne(ticketFilter);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    if (status) ticket.status = status;
    if (priority) ticket.priority = priority;
    if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
      const assignee = await User.findOne({ _id: assignedTo, companyCode: req.user.companyCode }).select("name");
      if (assignee) {
        ticket.assignedTo = assignee._id;
        ticket.assignedToName = assignee.name;
      }
    }
    if (message) {
      ticket.messages.push({
        sender: req.user._id,
        senderName: req.user.name,
        senderRole: "agent",
        message,
      });
      ticket.lastResponseAt = new Date();
      if (ticket.status === "Waiting") {
        ticket.status = "In Progress";
      }
    }

    await ticket.save();

    try {
      await notifyDirectUsers({
        userIds: [ticket.requester],
        targetPath: "/ciisUser/contact-support",
        type: "support_ticket_updated",
        title: `Support Ticket ${ticket.status}`,
        message: `${ticket.ticketNumber} has been updated${message ? ": " + message : ""}`,
        actor: req.user._id,
        company: getCompanyId(req),
        data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber, status: ticket.status },
        priority: ticket.priority === "Critical" ? "high" : "medium",
      });
    } catch (error) {
      console.error("Support ticket update notification failed:", error.message);
    }

    res.json({ success: true, message: "Ticket updated successfully", ticket: serializeTicket(ticket) });
  } catch (error) {
    console.error("Update support ticket error:", error);
    res.status(500).json({ success: false, message: "Failed to update ticket" });
  }
};

exports.createEnquiry = async (req, res) => {
  try {
    const { name, email, phone, subject, message, source } = req.body;
    if (!subject || !name) {
      return res.status(400).json({ success: false, message: "Name and subject are required" });
    }

    const enquiry = await SupportEnquiry.create({
      company: getCompanyId(req),
      companyCode: req.user.companyCode,
      name,
      email,
      phone,
      subject,
      message,
      source: source || "portal",
    });

    res.status(201).json({ success: true, message: "Enquiry submitted", enquiry });
  } catch (error) {
    console.error("Create support enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to submit enquiry" });
  }
};

exports.getEnquiries = async (req, res) => {
  try {
    if (!isSupportAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Support admin access required" });
    }
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const filter = getCompanyFilter(req);
    const [enquiries, total] = await Promise.all([
      SupportEnquiry.find(filter)
        .select("company companyCode name email phone subject message source status convertedTicket assignedTo createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportEnquiry.countDocuments(filter)
    ]);
    res.json({ success: true, enquiries, count: enquiries.length, total, pagination: buildPaginationMeta({ page, limit, total }) });
  } catch (error) {
    console.error("Get support enquiries error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
};

exports.askChatbot = async (req, res) => {
  try {
    const { question, createTicket, departmentId } = req.body;
    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, message: "Question is required" });
    }

    const departments = await getSupportDepartments(req);
    if (!departmentId) {
      const log = await ChatbotLog.create({
        company: getCompanyId(req),
        companyCode: req.user.companyCode,
        user: req.user._id,
        userName: req.user.name,
        question,
        answer: "Please select the department you need help from.",
        intent: "Department Selection",
        confidence: 100,
        outcome: "Agent handoff",
      });

      return res.json({
        success: true,
        needsDepartment: true,
        answer: "Please select the department you need help from.",
        statusMessage: "Select a department to forward this query.",
        departments,
        logId: log._id,
      });
    }

    const selectedDepartment = await Department.findOne({
      _id: departmentId,
      ...getDepartmentQuery(req),
    }).populate("supportHead", "name email");

    if (!selectedDepartment) {
      return res.status(404).json({ success: false, message: "Selected department not found" });
    }

    const response = getChatbotAnswer(question);
    let ticket = null;

    if (createTicket !== false) {
      const departmentName = getDepartmentName(selectedDepartment);
      ticket = await SupportTicket.create({
        company: getCompanyId(req),
        companyCode: req.user.companyCode,
        requester: req.user._id,
        requesterName: req.user.name,
        requesterEmail: req.user.email,
        departmentId: selectedDepartment._id,
        department: departmentName,
        subject: String(question).slice(0, 140),
        description: question,
        category: response.intent.includes("Payroll") ? "Payroll" : response.intent.includes("Asset") ? "Assets" : "General",
        priority: "Medium",
        source: "chatbot",
        status: "Waiting",
        assignedTo: selectedDepartment.supportHead?._id,
        assignedToName: selectedDepartment.supportHead?.name || selectedDepartment.supportHeadName,
        messages: [{
          sender: req.user._id,
          senderName: req.user.name,
          senderRole: "employee",
          message: question,
        }],
      });
      response.outcome = "Ticket created";

      try {
        if (selectedDepartment.supportHead?._id) {
          await notifyDirectUsers({
            userIds: [selectedDepartment.supportHead._id],
            targetPath: "/ciisUser/support-desk",
            type: "support_chat_forwarded",
            title: "New Support Chat",
            message: `${req.user.name} sent a ${departmentName} query: ${String(question).slice(0, 90)}`,
            actor: req.user._id,
            company: getCompanyId(req),
            data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber, departmentId: selectedDepartment._id },
            priority: "medium",
          });
        } else {
          await notifyPageUsers({
            companyId: getCompanyId(req),
            targetPath: "/ciisUser/support-operations",
            excludeUserIds: [req.user._id],
            type: "support_chat_unassigned",
            title: "Unassigned Department Support Chat",
            message: `${departmentName} received a support query but has no Department Head assigned.`,
            actor: req.user._id,
            data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber, departmentId: selectedDepartment._id },
            priority: "medium",
          });
        }
      } catch (error) {
        console.error("Support chatbot routing notification failed:", error.message);
      }
    }

    const log = await ChatbotLog.create({
      company: getCompanyId(req),
      companyCode: req.user.companyCode,
      user: req.user._id,
      userName: req.user.name,
      departmentId: selectedDepartment._id,
      departmentName: getDepartmentName(selectedDepartment),
      question,
      answer: "Waiting for Response from Department Head",
      intent: response.intent,
      confidence: response.confidence,
      outcome: response.outcome,
      ticket: ticket?._id,
    });

    res.json({
      success: true,
      answer: "Waiting for Response from Department Head",
      statusMessage: "Waiting for Response from Department Head",
      department: {
        id: selectedDepartment._id,
        name: getDepartmentName(selectedDepartment),
        supportHeadName: selectedDepartment.supportHead?.name || selectedDepartment.supportHeadName || "Not assigned",
      },
      intent: response.intent,
      confidence: response.confidence,
      outcome: response.outcome,
      ticket: ticket ? serializeTicket(ticket) : null,
      logId: log._id,
    });
  } catch (error) {
    console.error("Support chatbot error:", error);
    res.status(500).json({ success: false, message: "Chatbot failed to respond" });
  }
};

exports.getChatbotLogs = async (req, res) => {
  try {
    if (!isSupportAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Support admin access required" });
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const filter = getCompanyFilter(req);
    const [logs, total] = await Promise.all([
      ChatbotLog.find(filter)
        .select("company companyCode user userName departmentId departmentName question answer intent confidence outcome ticket createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ChatbotLog.countDocuments(filter)
    ]);
    const intentStats = await ChatbotLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$intent",
          count: { $sum: 1 },
          confidence: { $avg: "$confidence" },
          latestOutcome: { $last: "$outcome" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    res.json({
      success: true,
      logs,
      count: logs.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      intentStats: intentStats.map(item => ({
        intent: item._id,
        count: item.count,
        confidence: Math.round(item.confidence || 0),
        outcome: item.latestOutcome || "Resolved",
      })),
    });
  } catch (error) {
    console.error("Get chatbot logs error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch chatbot logs" });
  }
};

exports.getDepartmentsForSupport = async (req, res) => {
  try {
    const departments = await getSupportDepartments(req);
    res.json({ success: true, departments });
  } catch (error) {
    console.error("Get support departments error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch support departments" });
  }
};

exports.getAdminDepartments = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    let departments = await Department.find(getDepartmentQuery(req))
      .populate("supportHead", "name email jobRole")
      .sort({ name: 1 })
      .lean();

    if (!departments.length && access.admin) {
      departments = await getVirtualDepartmentsFromUsers(req);
    }

    if (!access.admin) {
      departments = departments.filter(department =>
        String(department.supportHead?._id || department.supportHead) === String(req.user._id)
      );
    }

    const items = await Promise.all(departments.map(async department => {
      const [employees, openTickets] = await Promise.all([
        getDepartmentEmployees(req, department),
        SupportTicket.countDocuments({
          ...getCompanyFilter(req),
          $or: [
            { departmentId: mongoose.Types.ObjectId.isValid(getEntityId(department._id)) ? department._id : undefined },
            { department: getEntityId(department._id) },
            { department: getDepartmentName(department) },
          ].filter(condition => Object.values(condition)[0] !== undefined),
          status: { $nin: ["Resolved", "Closed"] },
        }),
      ]);

      return {
        id: getEntityId(department._id || department.id),
        name: getDepartmentName(department),
        description: department.description,
        employeeCount: employees.length,
        openTickets,
        supportHead: department.supportHead ? {
          id: department.supportHead._id,
          name: department.supportHead.name,
          email: department.supportHead.email,
          jobRole: department.supportHead.jobRole,
        } : null,
        supportHeadName: department.supportHeadName || department.supportHead?.name || "Unassigned",
      };
    }));

    res.json({ success: true, departments: items });
  } catch (error) {
    console.error("Get admin support departments error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch support departments" });
  }
};

exports.getDepartmentEmployees = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    const department = mongoose.Types.ObjectId.isValid(req.params.id)
      ? await Department.findOne({
          _id: req.params.id,
          ...getDepartmentQuery(req),
        }).populate("supportHead", "name email jobRole")
      : { _id: req.params.id, name: req.params.id, virtual: true };

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    if (!access.admin && String(department.supportHead?._id || department.supportHead) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "You can only manage your department" });
    }

    const employees = await getDepartmentEmployees(req, department);
    res.json({
      success: true,
      department: {
        id: getEntityId(department._id || department.id),
        name: getDepartmentName(department),
        supportHead: department.supportHead ? {
          id: department.supportHead._id,
          name: department.supportHead.name,
          email: department.supportHead.email,
          jobRole: department.supportHead.jobRole,
        } : null,
        supportHeadName: department.supportHeadName || department.supportHead?.name || "Unassigned",
      },
      employees,
    });
  } catch (error) {
    console.error("Get support department employees error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch department employees" });
  }
};

exports.assignDepartmentHead = async (req, res) => {
  try {
    if (!isSupportAdmin(req.user) && !isCompanyOwner(req.user)) {
      return res.status(403).json({ success: false, message: "Owner or support admin access required" });
    }

    const { employeeId } = req.body;
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Valid employeeId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Create this department in Department Management before assigning a Department Head",
      });
    }

    const department = await Department.findOne({
      _id: req.params.id,
      ...getDepartmentQuery(req),
    });

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    const employee = await User.findOne({
      _id: employeeId,
      companyCode: req.user.companyCode,
      isActive: true,
    }).select("name email jobRole companyRole department");

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const departmentName = getDepartmentName(department);
    const employeeDepartment = String(employee.department || "");
    const isSameDepartment =
      employeeDepartment === String(department._id) ||
      employeeDepartment.toLowerCase() === departmentName.toLowerCase();

    if (!isSameDepartment) {
      return res.status(400).json({ success: false, message: "Employee must belong to the selected department" });
    }

    department.supportHead = employee._id;
    department.supportHeadName = employee.name;
    await department.save();

    await SupportTicket.updateMany({
      ...getCompanyFilter(req),
      $or: [
        { departmentId: department._id },
        { department: departmentName },
      ],
      status: { $nin: ["Resolved", "Closed"] },
    }, {
      $set: {
        assignedTo: employee._id,
        assignedToName: employee.name,
      },
    });

    res.json({
      success: true,
      message: `${employee.name} assigned as ${departmentName} Department Head`,
      department: {
        id: department._id,
        name: departmentName,
        supportHead: {
          id: employee._id,
          name: employee.name,
          email: employee.email,
          jobRole: employee.jobRole,
        },
        supportHeadName: employee.name,
      },
    });
  } catch (error) {
    console.error("Assign department head error:", error);
    res.status(500).json({ success: false, message: "Failed to assign department head" });
  }
};

exports.getKnowledgeBase = async (req, res) => {
  try {
    await seedDefaultArticles(req);
    const { q, category } = req.query;
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const filter = { ...getCompanyFilter(req), isPublished: true };
    if (category && category !== "All") filter.category = category;
    if (q) filter.$or = [
      { title: new RegExp(q, "i") },
      { summary: new RegExp(q, "i") },
      { tags: new RegExp(q, "i") },
    ];

    const [articles, total] = await Promise.all([
      KnowledgeBaseArticle.find(filter)
        .select("company companyCode title category summary content tags views isPublished createdBy createdAt updatedAt")
        .sort({ views: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      KnowledgeBaseArticle.countDocuments(filter)
    ]);
    res.json({ success: true, articles, count: articles.length, total, pagination: buildPaginationMeta({ page, limit, total }) });
  } catch (error) {
    console.error("Get knowledge base error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch knowledge base" });
  }
};

exports.createKnowledgeBaseArticle = async (req, res) => {
  try {
    if (!isSupportAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Support admin access required" });
    }
    const { title, category, summary, content, tags } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: "Article title is required" });
    }

    const article = await KnowledgeBaseArticle.create({
      company: getCompanyId(req),
      companyCode: req.user.companyCode,
      title,
      category: category || "General",
      summary,
      content,
      tags: Array.isArray(tags) ? tags : [],
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: "Article created", article });
  } catch (error) {
    console.error("Create knowledge article error:", error);
    res.status(500).json({ success: false, message: "Failed to create article" });
  }
};

exports.getEmployeeOverview = async (req, res) => {
  try {
    await seedDefaultArticles(req);
    const filter = getCompanyFilter(req);
    const [activeTickets, myTickets, articles, lastLog] = await Promise.all([
      SupportTicket.countDocuments({ ...filter, requester: req.user._id, status: { $nin: ["Resolved", "Closed"] } }),
      SupportTicket.find({ ...filter, requester: req.user._id })
        .select("ticketNumber company companyCode requester requesterName requesterEmail departmentId department subject description category source status priority assignedTo assignedToName slaDueAt resolvedAt lastResponseAt satisfactionScore tags messages createdAt updatedAt")
        .sort({ updatedAt: -1 })
        .limit(6)
        .lean(),
      KnowledgeBaseArticle.find({ ...filter, isPublished: true })
        .select("company companyCode title category summary views isPublished createdBy createdAt updatedAt")
        .sort({ views: -1 })
        .limit(4)
        .lean(),
      ChatbotLog.findOne({ ...filter, user: req.user._id }).sort({ createdAt: -1 }).lean(),
    ]);

    res.json({
      success: true,
      stats: {
        activeTickets,
        knowledgeArticles: await KnowledgeBaseArticle.countDocuments({ ...filter, isPublished: true }),
        chatbotStatus: "24/7",
        liveChatWait: "02:15",
      },
      tickets: myTickets.map(serializeTicket),
      articles,
      chatbotMessages: [
        { from: "bot", text: "Hi, I can help with HR, IT, payroll, assets, and policy questions." },
        ...(lastLog ? [
          { from: "user", text: lastLog.question },
          { from: "bot", text: lastLog.answer },
        ] : []),
      ],
    });
  } catch (error) {
    console.error("Employee support overview error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch support overview" });
  }
};

exports.getAdminDashboard = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    const filter = await getManagedTicketFilter(req, getCompanyFilter(req));
    const companyFilter = getCompanyFilter(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      enquiries,
      newEnquiriesToday,
      openTickets,
      escalatedTickets,
      chatbotLogs,
      answeredLogs,
      tickets,
      queueStats,
      chatbotIntentStats,
    ] = await Promise.all([
      SupportEnquiry.countDocuments(companyFilter),
      SupportEnquiry.countDocuments({ ...companyFilter, createdAt: { $gte: today } }),
      SupportTicket.countDocuments({ ...filter, status: { $nin: ["Resolved", "Closed"] } }),
      SupportTicket.countDocuments({ ...filter, status: "Escalated" }),
      ChatbotLog.countDocuments(companyFilter),
      ChatbotLog.countDocuments({ ...companyFilter, outcome: { $in: ["Resolved", "Article served"] } }),
      SupportTicket.find(filter)
        .select("ticketNumber company companyCode requester requesterName requesterEmail departmentId department subject description category source status priority assignedTo assignedToName slaDueAt resolvedAt lastResponseAt satisfactionScore tags messages createdAt updatedAt")
        .populate("requester", "name email department")
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      SupportTicket.aggregate([
        { $match: filter },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ChatbotLog.aggregate([
        { $match: companyFilter },
        { $group: { _id: "$intent", count: { $sum: 1 }, confidence: { $avg: "$confidence" }, outcome: { $last: "$outcome" } } },
        { $sort: { count: -1 } },
        { $limit: 4 },
      ]),
    ]);

    const resolved = await SupportTicket.countDocuments({ ...filter, status: { $in: ["Resolved", "Closed"] } });
    const totalTickets = await SupportTicket.countDocuments(filter);
    const slaHealth = totalTickets ? Math.round((resolved / totalTickets) * 100) : 94;
    const deflection = chatbotLogs ? Math.round((answeredLogs / chatbotLogs) * 100) : 91;
    const maxQueue = Math.max(1, ...queueStats.map(item => item.count));

    res.json({
      success: true,
      stats: {
        enquiries,
        newEnquiriesToday,
        openTickets,
        escalatedTickets,
        chatbotLogs,
        chatbotDeflection: deflection,
        employeeIssues: openTickets,
        slaHealth,
        reportsReady: 12,
        avgResponse: "6m",
      },
      tickets: tickets.map(serializeTicket),
      queueLoad: queueStats.map(item => ({
        label: item._id || "General",
        value: Math.round((item.count / maxQueue) * 100),
        count: item.count,
      })),
      chatbotLogs: chatbotIntentStats.map(item => ({
        intent: item._id,
        count: item.count,
        confidence: `${Math.round(item.confidence || 0)}%`,
        outcome: item.outcome || "Resolved",
      })),
      insights: [
        {
          title: openTickets > 10 ? "Support queue needs attention" : "Support queue is healthy",
          detail: `${openTickets} active tickets are currently assigned across support queues.`,
        },
        {
          title: `Chatbot deflection is ${deflection}%`,
          detail: "Keep adding knowledge base articles for intents with agent handoff outcomes.",
        },
        {
          title: `${newEnquiriesToday} new enquiries today`,
          detail: "Review new enquiries and convert actionable items into tickets.",
        },
      ],
    });
  } catch (error) {
    console.error("Admin support dashboard error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch support dashboard" });
  }
};

exports.getReports = async (req, res) => {
  try {
    const access = await requireSupportAccess(req, res);
    if (!access.allowed) return;

    const filter = await getManagedTicketFilter(req, getCompanyFilter(req));
    const [byStatus, byPriority, byCategory] = await Promise.all([
      SupportTicket.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SupportTicket.aggregate([{ $match: filter }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      SupportTicket.aggregate([{ $match: filter }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
    ]);

    res.json({
      success: true,
      generatedAt: new Date(),
      reports: { byStatus, byPriority, byCategory },
    });
  } catch (error) {
    console.error("Support reports error:", error);
    res.status(500).json({ success: false, message: "Failed to generate support reports" });
  }
};
