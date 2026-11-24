const Task = require('../../HR-CDS/models/Task');
const User = require('../../models/User');
const ProjectModel = require('../../HR-CDS/models/Project');
const Project = ProjectModel.Project || ProjectModel;

/**
 * Task Tools with RBAC enforcement
 */
const taskTools = [
  {
    name: 'create_personal_task',
    description: 'Creates a personal task for the authenticated user.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Detailed description' },
        dueDateTime: { type: 'string', description: 'Due date and time in ISO or YYYY-MM-DD HH:mm format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' }
      },
      required: ['title']
    },
    permissionCheck: () => true, // Available to all users
    handler: async (args, ctx) => {
      const { title, description = '', dueDateTime, priority = 'Medium' } = args;
      const task = await Task.create({
        companyCode: ctx.companyCode,
        company: ctx.companyId,
        title: title.trim(),
        description: description.trim(),
        taskType: 'self',
        assignedUsers: [ctx.user._id],
        createdBy: ctx.user._id,
        dueDateTime: dueDateTime ? new Date(dueDateTime) : new Date(Date.now() + 86400000),
        priority: String(priority || 'medium').toLowerCase(),
        status: 'pending'
      });
      return {
        success: true,
        message: `Personal task '${task.title}' created successfully`,
        task: {
          id: task._id,
          title: task.title,
          priority: task.priority,
          status: task.status,
          dueDateTime: task.dueDateTime
        }
      };
    }
  },

  {
    name: 'assign_task',
    description: 'Assigns a task to another team member or employee. Requires Team/Manager/Admin permissions.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Detailed description of what needs to be done' },
        assigneeNameOrEmail: { type: 'string', description: 'Name or email of the employee to assign' },
        dueDateTime: { type: 'string', description: 'Due date/time' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        projectId: { type: 'string', description: 'Optional Project ID if associated with a project' }
      },
      required: ['title', 'assigneeNameOrEmail']
    },
    permissionCheck: (ctx) => ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const { title, description = '', assigneeNameOrEmail, dueDateTime, priority = 'Medium', projectId } = args;
      
      const targetUser = await User.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { email: { $regex: new RegExp(`^${assigneeNameOrEmail.trim()}$`, 'i') } },
          { name: { $regex: new RegExp(assigneeNameOrEmail.trim(), 'i') } }
        ]
      }).select('_id name email role');

      if (!targetUser) {
        throw new Error(`Employee matching '${assigneeNameOrEmail}' was not found in company ${ctx.companyCode}.`);
      }

      let projectRef = null;
      if (projectId) {
        projectRef = await Project.findOne({ _id: projectId, companyCode: ctx.companyCode });
      }

      const task = await Task.create({
        companyCode: ctx.companyCode,
        company: ctx.companyId,
        title: title.trim(),
        description: description.trim(),
        taskType: projectRef ? 'project' : 'assigned',
        project: projectRef ? projectRef._id : null,
        assignedUsers: [targetUser._id],
        createdBy: ctx.user._id,
        dueDateTime: dueDateTime ? new Date(dueDateTime) : new Date(Date.now() + 86400000),
        priority: String(priority || 'medium').toLowerCase(),
        status: 'pending'
      });

      return {
        success: true,
        message: `Task '${task.title}' assigned successfully to ${targetUser.name} (${targetUser.email})`,
        task: {
          id: task._id,
          title: task.title,
          assignedTo: targetUser.name,
          priority: task.priority,
          status: task.status,
          dueDateTime: task.dueDateTime
        }
      };
    }
  },

  {
    name: 'create_project_task',
    description: 'Creates a task within an existing project. Requires Project/Admin access.',
    parameters: {
      type: 'object',
      properties: {
        projectNameOrId: { type: 'string', description: 'Project Name or MongoDB ID' },
        title: { type: 'string', description: 'Title of the project task' },
        description: { type: 'string', description: 'Task description' },
        assigneeNameOrEmail: { type: 'string', description: 'Optional member to assign' },
        dueDateTime: { type: 'string', description: 'Due date/time' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' }
      },
      required: ['projectNameOrId', 'title']
    },
    permissionCheck: (ctx) => ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const { projectNameOrId, title, description = '', assigneeNameOrEmail, dueDateTime, priority = 'Medium' } = args;
      
      const project = await Project.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { _id: projectNameOrId.match(/^[0-9a-fA-F]{24}$/) ? projectNameOrId : null },
          { projectName: { $regex: new RegExp(projectNameOrId.trim(), 'i') } }
        ].filter(Boolean)
      });

      if (!project) {
        throw new Error(`Project matching '${projectNameOrId}' was not found in company ${ctx.companyCode}.`);
      }

      let assignedUser = ctx.user;
      if (assigneeNameOrEmail) {
        const found = await User.findOne({
          companyCode: ctx.companyCode,
          $or: [
            { email: { $regex: new RegExp(`^${assigneeNameOrEmail.trim()}$`, 'i') } },
            { name: { $regex: new RegExp(assigneeNameOrEmail.trim(), 'i') } }
          ]
        });
        if (found) assignedUser = found;
      }

      const task = await Task.create({
        companyCode: ctx.companyCode,
        company: ctx.companyId,
        project: project._id,
        title: title.trim(),
        description: description.trim(),
        taskType: 'project',
        assignedUsers: [assignedUser._id],
        createdBy: ctx.user._id,
        dueDateTime: dueDateTime ? new Date(dueDateTime) : new Date(Date.now() + 86400000),
        priority: String(priority || 'medium').toLowerCase(),
        status: 'pending'
      });

      return {
        success: true,
        message: `Task '${task.title}' created in project '${project.projectName}'`,
        task: {
          id: task._id,
          project: project.projectName,
          title: task.title,
          assignedTo: assignedUser.name,
          priority: task.priority,
          status: task.status
        }
      };
    }
  },

  {
    name: 'list_tasks',
    description: 'Lists tasks based on filters. Regular employees see only their tasks; Admins/Managers can view team tasks.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['my', 'all', 'completed', 'pending', 'overdue'], default: 'my' },
        limit: { type: 'number', default: 20 }
      }
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { filter = 'my', limit = 20 } = args;
      const query = { companyCode: ctx.companyCode };

      if (!ctx.permissions.isAdmin && !ctx.permissions.isManager) {
        query.assignedUsers = ctx.user._id;
      } else if (filter === 'my') {
        query.assignedUsers = ctx.user._id;
      }

      if (filter === 'completed') {
        query.status = 'completed';
      } else if (filter === 'pending') {
        query.status = { $in: ['pending', 'in-progress', 'reopen'] };
      } else if (filter === 'overdue') {
        query.status = 'overdue';
      }

      const tasks = await Task.find(query)
        .populate('assignedUsers', 'name email')
        .populate('project', 'projectName')
        .sort({ dueDateTime: 1, createdAt: -1 })
        .limit(Math.min(limit, 50))
        .lean();

      return {
        total: tasks.length,
        tasks: tasks.map(t => ({
          id: t._id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDateTime: t.dueDateTime,
          project: t.project?.projectName || 'None',
          assignedTo: t.assignedUsers?.[0]?.name || 'Self'
        }))
      };
    }
  },

  {
    name: 'update_task_status',
    description: 'Updates task status (pending, in-progress, completed, onhold).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'MongoDB ID of the task' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'onhold', 'reopen'] },
        remarks: { type: 'string', description: 'Optional status change note' }
      },
      required: ['taskId', 'status']
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { taskId, status, remarks = '' } = args;
      const task = await Task.findOne({ _id: taskId, companyCode: ctx.companyCode });
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found.`);
      }

      // Check permission if regular employee
      if (!ctx.permissions.isAdmin && !ctx.permissions.isManager) {
        const isAssigned = (task.assignedUsers || []).some(id => String(id) === String(ctx.user._id));
        if (!isAssigned && String(task.createdBy) !== String(ctx.user._id)) {
          throw new Error('Permission denied: You can only update tasks assigned to you or created by you.');
        }
      }

      task.status = status;
      if (status === 'completed') {
        task.completedAt = new Date();
      }
      task.statusHistory = task.statusHistory || [];
      task.statusHistory.push({
        status,
        changedBy: ctx.user._id,
        remarks: remarks || `Updated via MCP AI`
      });
      await task.save();

      return {
        success: true,
        message: `Task '${task.title}' updated to ${status}.`
      };
    }
  }
];

module.exports = taskTools;
