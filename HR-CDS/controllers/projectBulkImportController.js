const ExcelJS = require("exceljs");
const mongoose = require("mongoose");
const { Project, PRIORITY_LEVELS, TASK_STATUS } = require("../models/Project");
const User = require("../../models/User");
const Branch = require("../../models/Branch");

const getUserCompanyId = (user = {}) => {
  const company = user.company;
  if (!company) return user.companyId || null;
  return company._id || company.id || company;
};

const getUserCompanyCode = (user = {}) => {
  return String(user.companyCode || user.companyIdentifier || "").trim().toUpperCase();
};

const normalizePriority = (value, fallback = "medium") => {
  const clean = String(value || "").trim().toLowerCase();
  if (PRIORITY_LEVELS.includes(clean)) return clean;
  if (clean === "high" || clean === "urgent") return "high";
  if (clean === "low") return "low";
  return fallback;
};

const normalizeStatus = (value, fallback = "pending") => {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "in progress" || clean === "inprogress" || clean === "in-progress") return "in progress";
  if (clean === "completed" || clean === "done") return "completed";
  if (clean === "on hold" || clean === "onhold" || clean === "on-hold") return "on hold";
  if (clean === "cancelled") return "cancelled";
  if (clean === "reopen" || clean === "re-open") return "reopen";
  return fallback;
};

const parseDateValue = (val) => {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  const str = String(val).trim();
  if (!str) return null;

  // Handle excel numeric serial dates if any
  if (typeof val === 'number') {
    const epoch = new Date(Math.round((val - 25569) * 86400 * 1000));
    return Number.isNaN(epoch.getTime()) ? null : epoch;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // Try DD-MM-YYYY or DD/MM/YYYY
  const parts = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    const year = parseInt(parts[3], 10);
    const hours = parts[4] ? parseInt(parts[4], 10) : 18;
    const minutes = parts[5] ? parseInt(parts[5], 10) : 0;
    const d = new Date(year, month, day, hours, minutes);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
};

const parseCheckpoints = (raw) => {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  return text
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((title) => ({
      title,
      completed: false,
      completedAt: null,
      completedBy: null,
      createdAt: new Date(),
    }));
};

/**
 * 1. Download Demo Sample Excel Template
 */
exports.downloadSampleExcel = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CIIS Network";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Projects and Tasks", {
      views: [{ showGridLines: true }],
    });

    sheet.columns = [
      { header: "Project Name", key: "projectName", width: 26 },
      { header: "Project Description", key: "projectDescription", width: 34 },
      { header: "Project Priority", key: "projectPriority", width: 16 },
      { header: "Project End Date (YYYY-MM-DD)", key: "projectEndDate", width: 28 },
      { header: "Task Title*", key: "taskTitle", width: 32 },
      { header: "Task Description", key: "taskDescription", width: 38 },
      { header: "Assigned Employee Email or Phone*", key: "assignedTo", width: 34 },
      { header: "Task Priority", key: "taskPriority", width: 16 },
      { header: "Task Due Date (YYYY-MM-DD)*", key: "taskDueDate", width: 28 },
      { header: "Checkpoints (Comma separated)", key: "checkpoints", width: 36 },
    ];

    // Style the header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1877F2" }, // Royal CIIS Blue
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    headerRow.height = 28;

    // Add sample rows for guidance
    sheet.addRow({
      projectName: "ERP System Revamp",
      projectDescription: "Upgrading core portal modules and client dashboards",
      projectPriority: "High",
      projectEndDate: "2026-12-31",
      taskTitle: "Design Database Architecture",
      taskDescription: "Create optimized schemas for tasks, projects and chat integration",
      assignedTo: req.user?.email || "developer@example.com",
      taskPriority: "High",
      taskDueDate: "2026-11-15",
      checkpoints: "Draft Schema, Review with Team, Finalize Indexing",
    });

    sheet.addRow({
      projectName: "ERP System Revamp",
      projectDescription: "Upgrading core portal modules and client dashboards",
      projectPriority: "High",
      projectEndDate: "2026-12-31",
      taskTitle: "Implement API Endpoints",
      taskDescription: "Build CRUD and bulk import endpoints with validation",
      assignedTo: req.user?.email || "developer@example.com",
      taskPriority: "Medium",
      taskDueDate: "2026-11-20",
      checkpoints: "Unit Testing, Integration Verification",
    });

    sheet.addRow({
      projectName: "ERP System Revamp",
      projectDescription: "Upgrading core portal modules and client dashboards",
      projectPriority: "High",
      projectEndDate: "2026-12-31",
      taskTitle: "Frontend UI Components",
      taskDescription: "Build interactive bulk upload modal with preview and validation",
      assignedTo: req.user?.email || "developer@example.com",
      taskPriority: "Medium",
      taskDueDate: "2026-11-25",
      checkpoints: "Mobile responsiveness, Error state previews",
    });

    // Style data rows
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: "middle", horizontal: "left" };
        row.height = 22;
      }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="CIIS_Project_Tasks_Template.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("❌ Error generating sample excel:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Error generating sample template", error: error.message });
    } else {
      res.end();
    }
  }
};

/**
 * 2. Bulk Import Projects and Tasks
 */
exports.bulkImportProjectsAndTasks = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel file (.xlsx or .xls)",
      });
    }

    const mode = String(req.body.mode || (req.body.projectId ? "existing" : "new")).toLowerCase();
    const targetProjectId = req.body.projectId ? String(req.body.projectId).trim() : null;
    const requestedBranchId = req.body.branchId ? String(req.body.branchId).trim() : null;

    const companyId = getUserCompanyId(req.user);
    const companyCode = getUserCompanyCode(req.user);

    // If existing project mode is selected, verify target project
    let existingProject = null;
    if (mode === "existing") {
      if (!targetProjectId || !mongoose.Types.ObjectId.isValid(targetProjectId)) {
        return res.status(400).json({
          success: false,
          message: "Please select a valid target project for Existing Project mode",
        });
      }

      existingProject = await Project.findOne({
        _id: targetProjectId,
        $or: [
          ...(companyId ? [{ company: companyId }] : []),
          ...(companyCode ? [{ companyCode }] : []),
        ],
      });

      if (!existingProject) {
        return res.status(404).json({
          success: false,
          message: "Selected target project not found or access denied",
        });
      }
    }

    // Load all active company users for mapping assignees
    const companyUsers = await User.find({
      $or: [
        ...(companyId ? [{ company: companyId }] : []),
        ...(companyCode ? [{ companyCode }] : []),
      ],
      isActive: { $ne: false },
    }).select("_id name email phone employeeId companyRole").lean();

    const userByEmail = new Map();
    const userByPhone = new Map();
    const userByEmpId = new Map();
    const userByName = new Map();

    companyUsers.forEach((u) => {
      if (u.email) userByEmail.set(String(u.email).trim().toLowerCase(), u);
      if (u.phone) {
        const cleanPhone = String(u.phone).replace(/\D+/g, "");
        if (cleanPhone) userByPhone.set(cleanPhone, u);
      }
      if (u.employeeId) userByEmpId.set(String(u.employeeId).trim().toLowerCase(), u);
      if (u.name) userByName.set(String(u.name).trim().toLowerCase(), u);
    });

    const findCompanyUser = (raw) => {
      if (!raw) return null;
      const str = String(raw).trim();
      const lower = str.toLowerCase();
      if (userByEmail.has(lower)) return userByEmail.get(lower);
      const digits = str.replace(/\D+/g, "");
      if (digits.length >= 7 && userByPhone.has(digits)) return userByPhone.get(digits);
      if (userByEmpId.has(lower)) return userByEmpId.get(lower);
      if (userByName.has(lower)) return userByName.get(lower);
      return null;
    };

    // Load workbook from buffer
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({
        success: false,
        message: "Excel sheet is empty or invalid",
      });
    }

    // Map column headers dynamically
    const headerRow = worksheet.getRow(1);
    const colIndex = {};

    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value || "").trim().toLowerCase();
      if (/project\s*name/i.test(val)) colIndex.projectName = colNumber;
      else if (/project\s*desc/i.test(val)) colIndex.projectDescription = colNumber;
      else if (/project\s*priority/i.test(val)) colIndex.projectPriority = colNumber;
      else if (/project\s*end/i.test(val)) colIndex.projectEndDate = colNumber;
      else if (/task\s*title|task\s*name/i.test(val)) colIndex.taskTitle = colNumber;
      else if (/task\s*desc/i.test(val)) colIndex.taskDescription = colNumber;
      else if (/assigned|assignee|employee|email|phone/i.test(val)) colIndex.assignedTo = colNumber;
      else if (/task\s*priority/i.test(val)) colIndex.taskPriority = colNumber;
      else if (/due\s*date|deadline/i.test(val)) colIndex.taskDueDate = colNumber;
      else if (/checkpoint/i.test(val)) colIndex.checkpoints = colNumber;
    });

    // Fallbacks if user altered header names slightly
    if (!colIndex.taskTitle) colIndex.taskTitle = 5;
    if (!colIndex.assignedTo) colIndex.assignedTo = 7;
    if (!colIndex.taskDueDate) colIndex.taskDueDate = 9;

    const rowErrors = [];
    const parsedRows = [];
    let totalRowsCount = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      // Extract raw cell values
      const getVal = (idx) => {
        if (!idx) return "";
        const c = row.getCell(idx);
        if (!c || c.value === null || c.value === undefined) return "";
        if (typeof c.value === "object" && c.value.text) return String(c.value.text).trim();
        if (c.value instanceof Date) return c.value;
        return String(c.value).trim();
      };

      const projectName = getVal(colIndex.projectName);
      const projectDescription = getVal(colIndex.projectDescription);
      const projectPriority = getVal(colIndex.projectPriority);
      const projectEndDate = getVal(colIndex.projectEndDate);
      const taskTitle = getVal(colIndex.taskTitle);
      const taskDescription = getVal(colIndex.taskDescription);
      const assignedToRaw = getVal(colIndex.assignedTo);
      const taskPriority = getVal(colIndex.taskPriority);
      const taskDueDateRaw = getVal(colIndex.taskDueDate);
      const checkpointsRaw = getVal(colIndex.checkpoints);

      // Check if row is completely empty
      const isBlank = !projectName && !taskTitle && !assignedToRaw && !taskDueDateRaw;
      if (isBlank) return;

      totalRowsCount += 1;

      // 1. Validate Project Name (Required in New Project mode)
      if (mode === "new" && !projectName) {
        rowErrors.push({
          row: rowNumber,
          field: "projectName",
          error: "Project Name is required when creating a new project",
        });
      }

      // 2. Validate Task Title (Always required)
      if (!taskTitle) {
        rowErrors.push({
          row: rowNumber,
          field: "taskTitle",
          error: "Task Title is required",
        });
      }

      // 3. Validate Assigned User
      let matchedUser = null;
      if (!assignedToRaw) {
        rowErrors.push({
          row: rowNumber,
          field: "assignedTo",
          error: "Assigned Employee Email or Phone is required",
        });
      } else {
        matchedUser = findCompanyUser(assignedToRaw);
        if (!matchedUser) {
          rowErrors.push({
            row: rowNumber,
            field: "assignedTo",
            error: `Employee "${assignedToRaw}" is not registered in your company`,
          });
        }
      }

      // 4. Validate Due Date
      let dueDate = null;
      if (!taskDueDateRaw) {
        rowErrors.push({
          row: rowNumber,
          field: "taskDueDate",
          error: "Task Due Date is required",
        });
      } else {
        dueDate = parseDateValue(taskDueDateRaw);
        if (!dueDate) {
          rowErrors.push({
            row: rowNumber,
            field: "taskDueDate",
            error: `Invalid date format for Task Due Date "${taskDueDateRaw}". Use YYYY-MM-DD`,
          });
        }
      }

      // Project end date (optional)
      let parsedProjectEndDate = null;
      if (projectEndDate) {
        parsedProjectEndDate = parseDateValue(projectEndDate);
      }

      parsedRows.push({
        rowNumber,
        projectName: projectName || existingProject?.projectName || "Imported Project",
        projectDescription: projectDescription || "",
        projectPriority: normalizePriority(projectPriority, "medium"),
        projectEndDate: parsedProjectEndDate,
        taskTitle,
        taskDescription: taskDescription || "",
        assignedUser: matchedUser,
        taskPriority: normalizePriority(taskPriority, "medium"),
        dueDate,
        checkpoints: parseCheckpoints(checkpointsRaw),
      });
    });

    if (totalRowsCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Uploaded Excel file does not contain any valid task rows",
      });
    }

    // If validation errors exist, return them cleanly
    if (rowErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: `Validation failed in Excel file: Found ${rowErrors.length} issue(s) across rows. Please review and re-upload.`,
        errors: rowErrors,
        totalRows: totalRowsCount,
        failedRows: rowErrors.length,
      });
    }

    // =========================================================================
    // EXECUTION: CREATE OR UPDATE
    // =========================================================================
    const creatorId = req.user.id || req.user._id;

    if (mode === "existing") {
      // -----------------------------------------------------------------------
      // MODE A: Add tasks to existing project
      // -----------------------------------------------------------------------
      const newTasks = [];
      const newUserIds = new Set((existingProject.users || []).map((u) => String(u._id || u)));

      for (const row of parsedRows) {
        const assignedUserId = row.assignedUser?._id;
        if (assignedUserId) newUserIds.add(String(assignedUserId));

        const taskDoc = {
          title: row.taskTitle,
          description: row.taskDescription,
          assignedTo: assignedUserId || null,
          assignedUsers: assignedUserId ? [assignedUserId] : [],
          dueDate: row.dueDate,
          dueDateTime: row.dueDate,
          priority: row.taskPriority,
          status: "pending",
          checkpoints: row.checkpoints,
          createdBy: creatorId,
          activityLogs: [
            {
              type: "creation",
              description: `Task created via Excel Bulk Import by ${req.user.name || "User"}`,
              performedBy: creatorId,
              performedAt: new Date(),
            },
          ],
        };

        newTasks.push(taskDoc);
      }

      existingProject.tasks.push(...newTasks);
      existingProject.users = Array.from(newUserIds).map((id) => new mongoose.Types.ObjectId(id));
      existingProject.markModified("tasks");
      existingProject.markModified("users");

      await existingProject.save();

      return res.status(200).json({
        success: true,
        message: `Successfully imported ${newTasks.length} task(s) into project "${existingProject.projectName}"`,
        mode: "existing",
        projectId: existingProject._id,
        projectName: existingProject.projectName,
        importedTasksCount: newTasks.length,
        totalProjectTasks: existingProject.tasks.length,
      });
    } else {
      // -----------------------------------------------------------------------
      // MODE B: Create new project(s) & their tasks
      // -----------------------------------------------------------------------
      const groupedByProject = new Map();

      for (const row of parsedRows) {
        const key = String(row.projectName).trim();
        if (!groupedByProject.has(key)) {
          groupedByProject.set(key, {
            projectName: key,
            description: row.projectDescription,
            priority: row.projectPriority,
            endDate: row.projectEndDate,
            tasks: [],
            userIds: new Set([String(creatorId)]),
          });
        }

        const group = groupedByProject.get(key);
        const assignedUserId = row.assignedUser?._id;
        if (assignedUserId) group.userIds.add(String(assignedUserId));

        group.tasks.push({
          title: row.taskTitle,
          description: row.taskDescription,
          assignedTo: assignedUserId || null,
          assignedUsers: assignedUserId ? [assignedUserId] : [],
          dueDate: row.dueDate,
          dueDateTime: row.dueDate,
          priority: row.taskPriority,
          status: "pending",
          checkpoints: row.checkpoints,
          createdBy: creatorId,
          activityLogs: [
            {
              type: "creation",
              description: `Task created via Excel Bulk Import by ${req.user.name || "User"}`,
              performedBy: creatorId,
              performedAt: new Date(),
            },
          ],
        });
      }

      const createdProjects = [];
      let totalTasksCount = 0;

      for (const [, projectData] of groupedByProject) {
        const newProject = new Project({
          projectName: projectData.projectName,
          description: projectData.description || `Project imported via Excel on ${new Date().toLocaleDateString()}`,
          company: companyId || req.user.company,
          companyCode: companyCode || req.user.companyCode,
          branch: requestedBranchId || req.user.branch || null,
          priority: projectData.priority || "medium",
          status: "active",
          startDate: new Date(),
          endDate: projectData.endDate || null,
          managers: [creatorId],
          users: Array.from(projectData.userIds).map((id) => new mongoose.Types.ObjectId(id)),
          createdBy: creatorId,
          tasks: projectData.tasks,
        });

        await newProject.save();

        createdProjects.push({
          _id: newProject._id,
          projectName: newProject.projectName,
          taskCount: newProject.tasks.length,
        });

        totalTasksCount += newProject.tasks.length;
      }

      return res.status(201).json({
        success: true,
        message: `Successfully created ${createdProjects.length} project(s) and ${totalTasksCount} task(s)`,
        mode: "new",
        createdProjects,
        importedProjectsCount: createdProjects.length,
        importedTasksCount: totalTasksCount,
      });
    }
  } catch (error) {
    console.error("❌ Error in bulkImportProjectsAndTasks:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during Excel bulk import: " + error.message,
      error: error.message,
    });
  }
};
