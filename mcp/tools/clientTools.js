const Client = require('../../HR-CDS/models/Client');
const ClientTask = require('../../HR-CDS/models/ClientTask');
const ClientPlan = require('../../HR-CDS/models/ClientPlan');
const User = require('../../models/User');

function renderEntityPreviewCard(headerTitle, rows) {
  const lines = [
    '┌────────────────────────────────────────────────────────┐',
    `│ 📋 ${headerTitle.padEnd(51, ' ')} │`,
    '├────────────────────────────────────────────────────────┤',
    ...rows.filter(Boolean).map(([k, v]) => `│ • ${(k + ':').padEnd(14, ' ')} ${v}`),
    '└────────────────────────────────────────────────────────┘',
    '',
    '⚠️ Ye abhi save nahi hua hai. Kripya neeche diye gaye 3 vikalpon me se chunein:',
    '1️⃣ Create / Confirm (Save karne ke liye "Create" ya "Confirm" bolein)',
    '2️⃣ Edit (Kisi bhi detail ko badalne ke liye bolein)',
    '3️⃣ Cancel (Cancel karne ke liye "Cancel" bolein)'
  ];
  return lines.join('\n');
}

const clientTools = [
  {
    name: 'create_client',
    description: 'Creates / adds a new Client in the CIIS database with company details, city, contact info, project manager(s), services, and optional client subscription plan. IMPORTANT: First call with confirmed: false (or omitted) to display the Preview Card with 3 options (Create / Confirm, Edit, Cancel). Only pass confirmed: true after user explicitly confirms.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Client contact person / primary name (required)' },
        company: { type: 'string', description: 'Client company / brand name (required)' },
        city: { type: 'string', description: 'City (required, e.g. Delhi, Mumbai, Chandigarh)' },
        projectManagers: { type: 'array', items: { type: 'string' }, description: 'Array of project manager names (defaults to authenticated user if omitted)' },
        email: { type: 'string', description: 'Client email address' },
        phone: { type: 'string', description: 'Client phone number' },
        industry: { type: 'string', description: 'Industry (e.g. IT, Healthcare, Retail)' },
        gst: { type: 'string', description: 'GST number' },
        pan: { type: 'string', description: 'PAN number' },
        website: { type: 'string', description: 'Client website URL' },
        state: { type: 'string', description: 'State' },
        country: { type: 'string', description: 'Country' },
        pincode: { type: 'string', description: 'Pincode / ZIP' },
        address: { type: 'string', description: 'Street address' },
        description: { type: 'string', description: 'Client description' },
        notes: { type: 'string', description: 'Additional notes' },
        services: { type: 'array', items: { type: 'string' }, description: 'List of services (e.g. ["SEO", "Web Development"])' },
        clientPlanNameOrId: { type: 'string', description: 'Optional Client Plan name or ID to attach to this client' },
        subscriptionStartDate: { type: 'string', description: 'Optional subscription start date (YYYY-MM-DD)' },
        status: { type: 'string', enum: ['Active', 'On Hold', 'Inactive'], default: 'Active' },
        confirmed: { type: 'boolean', default: false, description: 'Set to true ONLY after user confirms the Preview Card.' }
      },
      required: ['client', 'company', 'city']
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClients,
    handler: async (args, ctx) => {
      if (!ctx.permissions.canManageClients) {
        throw new Error('Permission denied: Your role does not have permission to add clients.');
      }

      const {
        client,
        company,
        city,
        projectManagers = [],
        email = '',
        phone = '',
        industry = '',
        gst = '',
        pan = '',
        website = '',
        state = '',
        country = '',
        pincode = '',
        address = '',
        description = '',
        notes = '',
        services = [],
        clientPlanNameOrId,
        subscriptionStartDate,
        status = 'Active',
        confirmed = false
      } = args;

      const resolvedManagers = Array.isArray(projectManagers) && projectManagers.filter(Boolean).length > 0
        ? projectManagers.map(m => String(m).trim()).filter(Boolean)
        : [ctx.user?.name || ctx.user?.email || 'Admin'];

      let matchedPlan = null;
      if (clientPlanNameOrId) {
        matchedPlan = await ClientPlan.findOne({
          companyCode: ctx.companyCode,
          $or: [
            { _id: String(clientPlanNameOrId).match(/^[0-9a-fA-F]{24}$/) ? clientPlanNameOrId : null },
            { name: { $regex: new RegExp(String(clientPlanNameOrId).trim(), 'i') } }
          ].filter(Boolean)
        }).lean();
      }

      const finalServices = Array.isArray(services) && services.length > 0
        ? services.map(s => String(s).trim()).filter(Boolean)
        : (matchedPlan && Array.isArray(matchedPlan.services) ? matchedPlan.services.map(s => s.service).filter(Boolean) : []);

      if (confirmed !== true) {
        const previewCard = renderEntityPreviewCard('CIIS CLIENT PREVIEW CARD (Confirm)', [
          ['Client Name', client],
          ['Company', company],
          ['City', city],
          ['Managers', resolvedManagers.join(', ')],
          email ? ['Email', email] : null,
          phone ? ['Phone', phone] : null,
          industry ? ['Industry', industry] : null,
          matchedPlan ? ['Plan', `${matchedPlan.name} (₹${matchedPlan.price || 0})`] : null,
          ['Services', finalServices.length > 0 ? finalServices.join(', ') : 'None'],
          ['Status', status]
        ]);

        return {
          requiresConfirmation: true,
          message: 'Client preview generated. Present this Preview Card to the user with 3 options (1. Create / Confirm, 2. Edit, 3. Cancel).',
          previewCard,
          options: ['Create / Confirm', 'Edit', 'Cancel'],
          clientData: { ...args, confirmed: true }
        };
      }

      const subscription = [];
      if (matchedPlan) {
        const start = subscriptionStartDate ? new Date(subscriptionStartDate) : new Date();
        const end = new Date(start);
        end.setMonth(end.getMonth() + (Number(matchedPlan.months) || 1));
        subscription.push({
          subscriptionNo: 1,
          planId: matchedPlan._id,
          planName: matchedPlan.name,
          servicesSnapshot: matchedPlan.services || [],
          startDate: start,
          endDate: end,
          status: 'Active'
        });
      }

      const created = await Client.create({
        client: client.trim(),
        company: company.trim(),
        city: city.trim(),
        companyCode: ctx.companyCode,
        projectManager: resolvedManagers,
        services: finalServices,
        activeClientPlan: matchedPlan ? matchedPlan._id : null,
        subscription,
        status,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        industry: industry.trim(),
        gst: gst.trim().toUpperCase(),
        pan: pan.trim().toUpperCase(),
        website: website.trim(),
        state: state.trim(),
        country: country.trim(),
        pincode: pincode.trim(),
        address: address.trim(),
        description: description.trim(),
        notes: notes.trim() || undefined
      });

      return {
        success: true,
        message: `Client '${created.client}' (${created.company}) added successfully.`,
        client: {
          id: created._id,
          client: created.client,
          company: created.company,
          city: created.city,
          projectManagers: created.projectManager,
          services: created.services,
          plan: matchedPlan ? matchedPlan.name : null,
          status: created.status
        }
      };
    }
  },

  {
    name: 'create_client_service_task',
    description: 'Creates a task under a specific Client and Service (e.g., SEO, Web Development, Social Media). IMPORTANT: First call with confirmed: false (or omitted) to show the Preview Card with 3 options (Create, Edit, Cancel).',
    parameters: {
      type: 'object',
      properties: {
        clientNameOrId: { type: 'string', description: 'Client name or MongoDB ID' },
        serviceName: { type: 'string', description: 'Name of the service (e.g. SEO, Content, Design)' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        dueDate: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        assigneeNameOrEmail: { type: 'string', description: 'Optional assignee' },
        confirmed: { type: 'boolean', default: false, description: 'Set to true ONLY after user confirms the Preview Card.' }
      },
      required: ['clientNameOrId', 'serviceName', 'title']
    },
    permissionCheck: (ctx) => ctx.permissions.canManageClientServices,
    handler: async (args, ctx) => {
      const { clientNameOrId, serviceName, title, description = '', dueDate, priority = 'Medium', assigneeNameOrEmail, confirmed = false } = args;

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

      if (confirmed !== true) {
        const previewCard = renderEntityPreviewCard('CIIS CLIENT TASK PREVIEW CARD', [
          ['Title', title],
          ['Client', client.client],
          ['Service', serviceName],
          ['Assignee', `${assignedUser.name} (${assignedUser.email || ''})`],
          ['Priority', priority],
          ['Due Date', dueDate || '3 days from now'],
          ['Description', description || '—']
        ]);

        return {
          requiresConfirmation: true,
          message: 'Client task preview generated. Present this Preview Card to the user with 3 options (1. Create / Confirm, 2. Edit, 3. Cancel).',
          previewCard,
          options: ['Create / Confirm', 'Edit', 'Cancel'],
          taskData: { ...args, confirmed: true }
        };
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
    description: 'Creates a new Client Subscription Plan with services & pricing. GATED: Requires SuperAdmin / Owner / Admin permissions. IMPORTANT: First call with confirmed: false (or omitted) to show Preview Card with 3 options (Create, Edit, Cancel).',
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
        },
        confirmed: { type: 'boolean', default: false, description: 'Set to true ONLY after user confirms the Preview Card.' }
      },
      required: ['name', 'price']
    },
    permissionCheck: (ctx) => ctx.permissions.canCreateClientPlans,
    handler: async (args, ctx) => {
      if (!ctx.permissions.canCreateClientPlans) {
        throw new Error('Permission denied: Only SuperAdmin, Company Owner, or Admin can create Client Plans.');
      }

      const { name, price, months = 1, description = '', services = [], confirmed = false } = args;

      const existing = await ClientPlan.findOne({ companyCode: ctx.companyCode, name: name.trim() });
      if (existing) {
        throw new Error(`A client plan with name '${name}' already exists in company ${ctx.companyCode}.`);
      }

      if (confirmed !== true) {
        const previewCard = renderEntityPreviewCard('CIIS CLIENT PLAN PREVIEW CARD', [
          ['Plan Name', name],
          ['Price', `₹${Number(price) || 0}`],
          ['Duration', `${Number(months) || 1} month(s)`],
          ['Services', Array.isArray(services) && services.length > 0 ? services.map(s => s.service).join(', ') : 'None'],
          ['Description', description || '—']
        ]);

        return {
          requiresConfirmation: true,
          message: 'Client plan preview generated. Present this Preview Card to the user with 3 options (1. Create / Confirm, 2. Edit, 3. Cancel).',
          previewCard,
          options: ['Create / Confirm', 'Edit', 'Cancel'],
          planData: { ...args, confirmed: true }
        };
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
