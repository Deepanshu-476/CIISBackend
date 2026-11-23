const Client = require('../../HR-CDS/models/Client');
const ClientTask = require('../../HR-CDS/models/ClientTask');
const ClientPlan = require('../../HR-CDS/models/ClientPlan');
const User = require('../../models/User');

const clientTools = [
  {
    name: 'create_client_service_task',
    description: 'Creates a task under a specific Client and Service (e.g., SEO, Web Development, Social Media).',
    parameters: {
      type: 'object',
      properties: {
        clientNameOrId: { type: 'string', description: 'Client name or MongoDB ID' },
        serviceName: { type: 'string', description: 'Name of the service (e.g. SEO, Content, Design)' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        dueDate: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        assigneeNameOrEmail: { type: 'string', description: 'Optional assignee' }
      },
      required: ['clientNameOrId', 'serviceName', 'title']
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClientServices,
    handler: async (args, ctx) => {
      const { clientNameOrId, serviceName, title, description = '', dueDate, priority = 'Medium', assigneeNameOrEmail } = args;

      const client = await Client.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { _id: clientNameOrId.match(/^[0-9a-fA-F]{24}$/) ? clientNameOrId : null },
          { client: { $regex: new RegExp(clientNameOrId.trim(), 'i') } }
        ].filter(Boolean)
      });

      if (!client) {
        throw new Error(`Client matching '${clientNameOrId}' was not found in company ${ctx.companyCode}.`);
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

      const clientTask = await ClientTask.create({
        clientId: client._id,
        service: serviceName.trim(),
        name: title.trim(),
        title: title.trim(),
        description: description.trim(),
        priority: priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase(),
        status: 'Pending',
        assigneeId: assignedUser._id,
        assignee: assignedUser.name,
        createdBy: ctx.user._id,
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 86400000 * 3)
      });

      return {
        success: true,
        message: `Task '${clientTask.title}' created successfully under service '${serviceName}' for client '${client.client}'.`,
        task: {
          id: clientTask._id,
          client: client.client,
          service: clientTask.service,
          title: clientTask.title,
          assignedTo: assignedUser.name,
          priority: clientTask.priority,
          status: clientTask.status
        }
      };
    }
  },

  {
    name: 'create_client_plan',
    description: 'Creates a new Client Subscription Plan with services & pricing. GATED: Requires SuperAdmin / Owner / Admin permissions.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plan name (e.g., Gold Plan, Premium SEO Plan)' },
        price: { type: 'number', description: 'Price of the plan in INR/currency' },
        months: { type: 'number', default: 1, description: 'Duration of the plan in months' },
        description: { type: 'string', description: 'Overview of the plan' },
        services: {
          type: 'array',
          description: 'Array of services included, e.g. [{"service": "SEO", "tasks": [{"name": "Keyword Research", "dueInDays": 5}]}]',
          items: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    priority: { type: 'string', enum: ['Low', 'Medium', 'High'] },
                    dueInDays: { type: 'number' }
                  },
                  required: ['name']
                }
              }
            },
            required: ['service']
          }
        }
      },
      required: ['name', 'price']
    },
    permissionCheck: (ctx) => ctx.permissions.canCreateClientPlans,
    handler: async (args, ctx) => {
      if (!ctx.permissions.canCreateClientPlans) {
        throw new Error('Permission denied: Only SuperAdmin, Company Owner, or Admin can create Client Plans.');
      }

      const { name, price, months = 1, description = '', services = [] } = args;

      const existing = await ClientPlan.findOne({ companyCode: ctx.companyCode, name: name.trim() });
      if (existing) {
        throw new Error(`A client plan with name '${name}' already exists in company ${ctx.companyCode}.`);
      }

      const plan = await ClientPlan.create({
        companyCode: ctx.companyCode,
        name: name.trim(),
        price: Number(price) || 0,
        months: Number(months) || 1,
        description: description.trim(),
        services: services.map(s => ({
          service: s.service.trim(),
          tasks: (s.tasks || []).map(t => ({
            name: t.name.trim(),
            description: (t.description || '').trim(),
            priority: t.priority || 'Medium',
            dueInDays: Number(t.dueInDays) || 0
          }))
        })),
        isActive: true
      });

      return {
        success: true,
        message: `Client Plan '${plan.name}' created successfully with ${plan.services.length} services included.`,
        plan: {
          id: plan._id,
          name: plan.name,
          price: plan.price,
          months: plan.months,
          servicesCount: plan.services.length
        }
      };
    }
  },

  {
    name: 'get_client_plans',
    description: 'Lists all available client plans in the company.',
    parameters: {
      type: 'object',
      properties: {
        activeOnly: { type: 'boolean', default: true }
      }
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClients,
    handler: async (args, ctx) => {
      const { activeOnly = true } = args;
      const query = { companyCode: ctx.companyCode };
      if (activeOnly) query.isActive = true;

      const plans = await ClientPlan.find(query).sort({ price: 1 }).lean();
      return {
        total: plans.length,
        plans: plans.map(p => ({
          id: p._id,
          name: p.name,
          price: p.price,
          months: p.months,
          description: p.description,
          services: p.services.map(s => s.service)
        }))
      };
    }
  },

  {
    name: 'list_client_tasks',
    description: 'Lists tasks associated with a client or specific service.',
    parameters: {
      type: 'object',
      properties: {
        clientNameOrId: { type: 'string', description: 'Client name or ID' },
        status: { type: 'string', enum: ['Pending', 'In Progress', 'Completed', 'all'], default: 'all' }
      },
      required: ['clientNameOrId']
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClientServices,
    handler: async (args, ctx) => {
      const { clientNameOrId, status = 'all' } = args;
      const client = await Client.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { _id: clientNameOrId.match(/^[0-9a-fA-F]{24}$/) ? clientNameOrId : null },
          { client: { $regex: new RegExp(clientNameOrId.trim(), 'i') } }
        ].filter(Boolean)
      });

      if (!client) {
        throw new Error(`Client matching '${clientNameOrId}' not found.`);
      }

      const query = { clientId: client._id };
      if (status !== 'all') query.status = status;

      const tasks = await ClientTask.find(query)
        .populate('assigneeId', 'name email')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

      return {
        client: client.client,
        total: tasks.length,
        tasks: tasks.map(t => ({
          id: t._id,
          service: t.service,
          title: t.name || t.title,
          status: t.status,
          priority: t.priority,
          assignedTo: t.assignee || t.assigneeId?.name || 'Unassigned',
          dueDate: t.dueDate
        }))
      };
    }
  },

  {
    name: 'list_clients_overview',
    description: 'Returns overview of clients, active plans, and contact details.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 20 }
      }
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClients,
    handler: async (args, ctx) => {
      const clients = await Client.find({ companyCode: ctx.companyCode })
        .select('client email phone activePlan status createdAt')
        .sort({ createdAt: -1 })
        .limit(Math.min(args.limit || 20, 50))
        .lean();

      return {
        total: clients.length,
        clients: clients.map(c => ({
          id: c._id,
          name: c.client,
          email: c.email,
          phone: c.phone,
          status: c.status || 'Active'
        }))
      };
    }
  }
];

module.exports = clientTools;
