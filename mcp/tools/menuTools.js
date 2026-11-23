/**
 * CIIS Portal Main Menu & Navigation Tools for MCP (ChatGPT & Claude)
 */

module.exports = [
  {
    name: 'get_portal_main_menu',
    description: 'Fetches the portal main menu, available modules, and permitted actions customized for the authenticated user. Use this when the user asks for "main menu", "menu dikhao", "kya kya options hain", "what can I do", or wants to explore features.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['all', 'tasks', 'attendance', 'clients', 'reports'],
          default: 'all',
          description: 'Optional category to focus the menu on'
        }
      }
    },
    permissionCheck: () => true, // Accessible to all users
    handler: async (args, ctx) => {
      const isOwnerOrAdmin = ctx.permissions.isSuperAdmin || ctx.permissions.isOwner || ctx.permissions.isAdmin;
      const isManagerOrHr = ctx.permissions.isManager || ctx.permissions.isHr;

      const menuSections = [
        {
          section: '📋 Task Management',
          description: 'Personal, project, and team task operations',
          options: [
            'Pending tasks dekhna ("mere pending tasks dikhao" / "show my pending tasks")',
            'Personal task add karna ("add a task: Review reports by tomorrow")',
            ...(isManagerOrHr || isOwnerOrAdmin ? [
              'Team member ko task assign karna ("assign task to Rahul: Client update")',
              'Project tasks create karna ("create project task under Alpha")'
            ] : []),
            'Task status update karna ("mark task 123 as completed")'
          ]
        },
        {
          section: '🕒 Attendance & Leaves',
          description: 'Attendance check-in status and history',
          options: [
            'Apni attendance dekhna ("aaj ki meri attendance status kya hai?")',
            ...(isManagerOrHr || isOwnerOrAdmin ? [
              'Company / Team attendance summary ("aaj ka attendance summary dikhao")',
              'Kisi specific employee ki attendance ("Rahul ki attendance check karo")'
            ] : [])
          ]
        },
        {
          section: '👥 Client Services',
          description: 'Client task tracking and deliverables',
          options: [
            'Client overview & active services ("client list dikhao")',
            'Client ke tasks check karna ("Acme Corp ke tasks list karo")',
            'Client service task add karna ("create service task for Client X under SEO")',
            ...(isOwnerOrAdmin ? [
              'New Client Plan create karna ("create client plan for 3 months")'
            ] : [])
          ]
        },
        {
          section: '📊 Reports & Exports',
          description: 'Unified PDF, Excel, and CSV downloads',
          options: [
            'Attendance report export link ("attendance sheet download link do")',
            'Tasks report export link ("pending tasks ki excel sheet do")',
            ...(isOwnerOrAdmin ? ['Client & project sheets export'] : [])
          ]
        }
      ];

      return {
        user: {
          name: ctx.user.name,
          email: ctx.user.email,
          role: ctx.permissions.role,
          companyCode: ctx.companyCode
        },
        languageInstruction: 'Reply to the user in the EXACT SAME language they used (Hinglish -> Hinglish, English -> English).',
        mainMenu: menuSections
      };
    }
  }
];
