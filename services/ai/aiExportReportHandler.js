/**
 * AI Export Report Handler
 * Handles natural language export/download queries in CIIS AI (Voice/Chat)
 */

const EXPORT_TRIGGER_REGEX = /(?:export|download|sheet|report|pdf|csv|xlsx|excel|डाउनलोड|एक्सपोर्ट|शीट|रिपोर्ट|chiaye|chaiye|chahiye|de\s*do|bhejo|nikalo|bna\s*do|banao|nikal\s*do)/i;

function isExportQuery(message) {
  if (!message || typeof message !== 'string') return false;
  const m = message.trim();
  if (m.length < 3) return false;
  return EXPORT_TRIGGER_REGEX.test(m);
}

async function handleExportRequest({ message, req, deps, currentDraft, isEn }) {
  const m = String(message || '').trim().toLowerCase();

  const isAttendance = /attend/i.test(m) || (/sheet/i.test(m) && /ajj|aaj|admin.*sheet/i.test(m) && !/task|client|project/i.test(m));
  const isClientMaster = /kitne\s*client|subscr|expire|kiska\s*plan|client.*(list|master|details)|all\s*client/i.test(m);
  const isClientTask = !isClientMaster && /client.*task|task.*client/i.test(m);
  const isProject = /project/i.test(m);
  const isTask = /task/i.test(m);

  const dateTodayStr = new Date().toISOString().slice(0, 10);

  // 1. ATTENDANCE EXPORT
  if (isAttendance) {
    const isSelf = /meri|merko|my|self/i.test(m) && !/admin|sabki|all/i.test(m);
    const isToday = /aaj|ajj|today/i.test(m);

    if (isSelf) {
      const reply = isEn
        ? "Here is your Attendance Sheet. You can download it in Excel or CSV format below:"
        : "Maine aapki Attendance Sheet taiyar kar di hai. Aap ise Excel ya CSV format mein download kar sakte hain:";
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Here is your attendance sheet." : "Aapki attendance sheet taiyar hai.",
        speakText: isEn ? "Here is your attendance sheet." : "Aapki attendance sheet taiyar hai.",
        draft: currentDraft,
        chips: [
          {
            label: "📥 Download Excel (.xlsx)",
            action: {
              type: "download_report",
              url: `/api/export-reports/attendance?type=self&format=xlsx`,
              filename: `My_Attendance_${dateTodayStr}.xlsx`
            }
          },
          {
            label: "📄 Download CSV (.csv)",
            action: {
              type: "download_report",
              url: `/api/export-reports/attendance?type=self&format=csv`,
              filename: `My_Attendance_${dateTodayStr}.csv`
            }
          },
          { label: "Main menu", action: { type: "reset" } }
        ],
        candidates: [],
        notices: []
      };
    }

    // Admin / Today attendance
    const reply = isEn
      ? "Here is the Company-wide Attendance Report for Today with employee in/out times and statuses:"
      : "Ye rahi aaj ki Company Attendance Sheet jisme sabhi employees ke in/out time aur status shamil hain:";
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? "Here is today's attendance report." : "Aaj ki attendance sheet taiyar hai.",
      speakText: isEn ? "Here is today's attendance report." : "Aaj ki attendance sheet taiyar hai.",
      draft: currentDraft,
      chips: [
        {
          label: "📥 Download Today's Excel (.xlsx)",
          action: {
            type: "download_report",
            url: `/api/export-reports/attendance?type=today&date=today&format=xlsx`,
            filename: `Today_Attendance_${dateTodayStr}.xlsx`
          }
        },
        {
          label: "📄 Download CSV (.csv)",
          action: {
            type: "download_report",
            url: `/api/export-reports/attendance?type=today&date=today&format=csv`,
            filename: `Today_Attendance_${dateTodayStr}.csv`
          }
        },
        {
          label: "📊 Monthly Attendance Report",
          action: {
            type: "download_report",
            url: `/api/export-reports/attendance?type=monthly&format=xlsx`,
            filename: `Monthly_Attendance_${dateTodayStr}.xlsx`
          }
        },
        { label: "Main menu", action: { type: "reset" } }
      ],
      candidates: [],
      notices: []
    };
  }

  // 2. CLIENTS MASTER SHEET (Subscriptions, Expiry, Total & Completed Tasks, Services)
  if (isClientMaster) {
    const reply = isEn
      ? "Here is the Clients & Subscriptions Master Sheet. It includes client status, plan name, expiry date (valid till), total tasks, completed tasks, and active services list:"
      : "Maine Clients Master Sheet taiyar kar di hai. Isme sabhi clients ka subscription status, expiry date (kab expire hoga), total tasks, completed tasks aur assigned services ki poori jaankari hai:";
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? "Here is the clients and subscriptions master sheet." : "Clients aur subscriptions ki master sheet taiyar hai.",
      speakText: isEn ? "Here is the clients and subscriptions master sheet." : "Clients aur subscriptions ki master sheet taiyar hai.",
      draft: currentDraft,
      chips: [
        {
          label: "📥 Download Clients Master (.xlsx)",
          action: {
            type: "download_report",
            url: `/api/export-reports/clients-master?format=xlsx`,
            filename: `Clients_Master_Report_${dateTodayStr}.xlsx`
          }
        },
        {
          label: "📄 Download CSV (.csv)",
          action: {
            type: "download_report",
            url: `/api/export-reports/clients-master?format=csv`,
            filename: `Clients_Master_Report_${dateTodayStr}.csv`
          }
        },
        { label: "Main menu", action: { type: "reset" } }
      ],
      candidates: [],
      notices: []
    };
  }

  // 3. SPECIFIC CLIENT TASKS
  if (isClientTask) {
    // Check if client is known from draft or message
    let matchedClient = null;
    const clients = deps?.accessibleClients || [];
    if (currentDraft?.clientId) {
      matchedClient = clients.find(c => String(c._id || c.id) === String(currentDraft.clientId));
    }
    if (!matchedClient && clients.length > 0) {
      for (const c of clients) {
        const cName = (c.client || c.name || '').toLowerCase();
        if (cName && m.includes(cName)) {
          matchedClient = c;
          break;
        }
      }
    }

    if (matchedClient) {
      const cId = String(matchedClient._id || matchedClient.id);
      const cName = matchedClient.client || matchedClient.name;
      const reply = isEn
        ? `Here are the tasks for client "${cName}". Download below:`
        : `Ye rahi client "${cName}" ke tasks ki sheet. Download karne ke liye neeche click karein:`;
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? `Client ${cName} tasks report.` : `Client ${cName} ke tasks ki report.`,
        speakText: isEn ? `Client ${cName} tasks report.` : `Client ${cName} ke tasks ki report.`,
        draft: currentDraft,
        chips: [
          {
            label: `📥 Download ${cName} Tasks (.xlsx)`,
            action: {
              type: "download_report",
              url: `/api/export-reports/client/${cId}/tasks?format=xlsx`,
              filename: `Client_${cName}_Tasks_${dateTodayStr}.xlsx`
            }
          },
          {
            label: `📄 Download CSV (.csv)`,
            action: {
              type: "download_report",
              url: `/api/export-reports/client/${cId}/tasks?format=csv`,
              filename: `Client_${cName}_Tasks_${dateTodayStr}.csv`
            }
          },
          { label: "Main menu", action: { type: "reset" } }
        ],
        candidates: [],
        notices: []
      };
    } else {
      // Suggest client selection chips
      const reply = isEn
        ? "Which client's tasks would you like to export? Please select a client below:"
        : "Aap kis client ke tasks export karna chahte hain? Kripya client select karein:";
      const clientChips = (clients.slice(0, 6) || []).map(c => ({
        label: c.client || c.name,
        action: {
          type: "download_report",
          url: `/api/export-reports/client/${c._id || c.id}/tasks?format=xlsx`,
          filename: `Client_${c.client || c.name}_Tasks_${dateTodayStr}.xlsx`
        }
      }));
      clientChips.push({ label: "Main menu", action: { type: "reset" } });

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Please select a client." : "Kripya client select karein.",
        speakText: isEn ? "Please select a client." : "Kripya client select karein.",
        draft: currentDraft,
        chips: clientChips,
        candidates: [],
        notices: []
      };
    }
  }

  // 4. PROJECT TASKS EXPORT (PDF & Excel)
  if (isProject) {
    let matchedProject = null;
    const projects = deps?.accessibleProjects || [];
    if (currentDraft?.projectId || currentDraft?.lastProjectId) {
      const pid = currentDraft.projectId || currentDraft.lastProjectId;
      matchedProject = projects.find(p => String(p._id || p.id) === String(pid));
    }
    if (!matchedProject && projects.length > 0) {
      for (const p of projects) {
        const pName = (p.projectName || p.name || '').toLowerCase();
        if (pName && m.includes(pName)) {
          matchedProject = p;
          break;
        }
      }
    }

    if (matchedProject) {
      const pId = String(matchedProject._id || matchedProject.id);
      const pName = matchedProject.projectName || matchedProject.name;
      const isUsers = /user|member|team/i.test(m);
      const reply = isEn
        ? `Here is the report for project "${pName}"${isUsers ? ' with team user tasks' : ''}. Download below:`
        : `Maine project "${pName}" ke sabhi tasks ki report taiyar kar di hai. Neeche diye button se download karein:`;

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? `Project ${pName} tasks report.` : `Project ${pName} ke tasks ki sheet taiyar hai.`,
        speakText: isEn ? `Project ${pName} tasks report.` : `Project ${pName} ke tasks ki sheet taiyar hai.`,
        draft: currentDraft,
        chips: [
          {
            label: `📥 Download ${pName} Excel (.xlsx)`,
            action: {
              type: "download_report",
              url: `/api/export-reports/project/${pId}/tasks?format=xlsx`,
              filename: `Project_${pName}_Tasks_${dateTodayStr}.xlsx`
            }
          },
          {
            label: `📄 Download CSV (.csv)`,
            action: {
              type: "download_report",
              url: `/api/export-reports/project/${pId}/tasks?format=csv`,
              filename: `Project_${pName}_Tasks_${dateTodayStr}.csv`
            }
          },
          { label: "Main menu", action: { type: "reset" } }
        ],
        candidates: [],
        notices: []
      };
    } else {
      // Prompt project selection
      const reply = isEn
        ? "Which project's tasks would you like to export? Please choose a project:"
        : "Aap kis project ke tasks export karna chahte hain? Kripya project chunein:";
      const projChips = (projects.slice(0, 6) || []).map(p => ({
        label: p.projectName || p.name,
        action: {
          type: "download_report",
          url: `/api/export-reports/project/${p._id || p.id}/tasks?format=xlsx`,
          filename: `Project_${p.projectName || p.name}_Tasks_${dateTodayStr}.xlsx`
        }
      }));
      projChips.push({ label: "Main menu", action: { type: "reset" } });

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Please select a project." : "Kripya project select karein.",
        speakText: isEn ? "Please select a project." : "Kripya project select karein.",
        draft: currentDraft,
        chips: projChips,
        candidates: [],
        notices: []
      };
    }
  }

  // 5. TASKS EXPORT (All Tasks / Single User Today Tasks)
  if (isTask || /sheet/i.test(m)) {
    const isAll = /sabke|all|admin.*task|company/i.test(m);
    const isToday = /aaj|ajj|today/i.test(m);

    // Check if a specific user name was mentioned (e.g. "rahul ke task")
    let targetUserName = null;
    const users = deps?.companyUsers || [];
    for (const u of users) {
      const uName = (u.name || '').toLowerCase();
      if (uName && uName.length >= 3 && m.includes(uName)) {
        targetUserName = u.name;
        break;
      }
    }

    if (isAll) {
      const reply = isEn
        ? "Here is the Tasks Report for all company users. You can download the full spreadsheet below:"
        : "Ye rahi sabhi company users ke tasks ki sheet. Aap ise Excel ya CSV format mein download kar sakte hain:";
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Here is the company-wide tasks sheet." : "Sabhi tasks ki sheet taiyar hai.",
        speakText: isEn ? "Here is the company-wide tasks sheet." : "Sabhi tasks ki sheet taiyar hai.",
        draft: currentDraft,
        chips: [
          {
            label: "📥 Download All Tasks (.xlsx)",
            action: {
              type: "download_report",
              url: `/api/export-reports/tasks?type=all&format=xlsx`,
              filename: `All_Tasks_${dateTodayStr}.xlsx`
            }
          },
          {
            label: "📄 Download CSV (.csv)",
            action: {
              type: "download_report",
              url: `/api/export-reports/tasks?type=all&format=csv`,
              filename: `All_Tasks_${dateTodayStr}.csv`
            }
          },
          { label: "Main menu", action: { type: "reset" } }
        ],
        candidates: [],
        notices: []
      };
    }

    // Single User (today or custom)
    const userLabel = targetUserName || (isToday ? "Today's Tasks" : "User Tasks");
    const queryParams = targetUserName
      ? `type=user&userName=${encodeURIComponent(targetUserName)}${isToday ? '&date=today' : ''}`
      : `type=self${isToday ? '&date=today' : ''}`;

    const reply = isEn
      ? `Here is the tasks sheet for ${userLabel}. Download below:`
      : `Maine ${userLabel} ki tasks sheet taiyar kar di hai. Neeche diye button se download karein:`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? `Tasks sheet for ${userLabel}.` : `${userLabel} ki sheet taiyar hai.`,
      speakText: isEn ? `Tasks sheet for ${userLabel}.` : `${userLabel} ki sheet taiyar hai.`,
      draft: currentDraft,
      chips: [
        {
          label: `📥 Download Tasks (.xlsx)`,
          action: {
            type: "download_report",
            url: `/api/export-reports/tasks?${queryParams}&format=xlsx`,
            filename: `${userLabel.replace(/\s+/g, '_')}_${dateTodayStr}.xlsx`
          }
        },
        {
          label: `📄 Download CSV (.csv)`,
          action: {
            type: "download_report",
            url: `/api/export-reports/tasks?${queryParams}&format=csv`,
            filename: `${userLabel.replace(/\s+/g, '_')}_${dateTodayStr}.csv`
          }
        },
        { label: "Main menu", action: { type: "reset" } }
      ],
      candidates: [],
      notices: []
    };
  }

  return null;
}

module.exports = {
  isExportQuery,
  handleExportRequest
};
