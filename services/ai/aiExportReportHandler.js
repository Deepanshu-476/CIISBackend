/**
 * AI Export Report Handler
 * Handles natural language export/download queries in CIIS AI (Voice/Chat)
 * Supports Attendance (any month/day/week/year), Tasks (single user/all),
 * Projects (single project/master), and Clients (single client/master).
 */

let mongoose;
let UserModel, ProjectModel, ClientModel;
try {
  mongoose = require('mongoose');
  UserModel = require('../../models/User');
  const projectModule = require('../../HR-CDS/models/Project');
  ProjectModel = projectModule?.Project || projectModule;
  ClientModel = require('../../HR-CDS/models/Client');
} catch (e) {
  // Graceful fallback for mock/standalone test environments
}

const EXPORT_VERB_REGEX = /(?:export|download|sheet|report|pdf|csv|xlsx|excel|डाउनलोड|एक्सपोर्ट|शीट|रिपोर्ट)/i;
const DESIRE_VERB_REGEX = /(?:chiaye|chaiye|chahiye|chayeye|chayie|chaye|mangta|de\s*do|bhejo|nikalo|bna\s*do|nikal\s*do|do\b)/i;

const MONTH_NAMES_MAP = {
  january: 1, jan: 1, 'जनवरी': 1,
  february: 2, feb: 2, 'फ़रवरी': 2, 'फरवरी': 2,
  march: 3, mar: 3, 'मार्च': 3,
  april: 4, apr: 4, 'अप्रैल': 4,
  may: 5, 'मई': 5,
  june: 6, jun: 6, 'जून': 6,
  july: 7, jul: 7, 'जुलाई': 7,
  august: 8, aug: 8, 'अगस्त': 8,
  september: 9, sep: 9, sept: 9, 'सितंबर': 9,
  october: 10, oct: 10, 'अक्टूबर': 10,
  november: 11, nov: 11, 'नवंबर': 11,
  december: 12, dec: 12, 'दिसंबर': 12
};

const MONTH_DISPLAY_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function isExportQuery(message) {
  if (!message || typeof message !== 'string') return false;
  const m = message.trim();
  if (m.length < 3) return false;

  // 1. Explicit export/sheet/report keyword
  if (EXPORT_VERB_REGEX.test(m)) {
    return true;
  }

  // 2. Report topics (attendance, task, project, client) + desire words
  if (/attend|hazri|हाजिरी|उपस्थिति|task|taks|project|projek|client|cleint/i.test(m) && DESIRE_VERB_REGEX.test(m)) {
    // Avoid intercepting task creation (e.g. "naya task chahiye")
    if (!/naya|new|create|assign|karna\s*hai|karni\s*hai|banao/i.test(m)) {
      return true;
    }
  }

  // 3. Client subscription & expiry overview queries
  if (/subscr|expire|kiska\s*plan|kitne\s*client.*(?:active|expire|plan)/i.test(m)) {
    return true;
  }

  return false;
}

/**
 * Robust Timeframe Extractor
 * Parses months (e.g. "october", "october month"), dates (e.g. "15 november", "2026-10-15"),
 * relative periods ("yesterday", "this week", "last week", "last month", "full month", "today").
 */
function extractTimeframe(m) {
  const currentYear = new Date().getFullYear();

  // 1. Check for explicit 4-digit year (e.g. 2025, 2026)
  const yearMatch = m.match(/\b(20\d{2})\b/);
  const targetYear = yearMatch ? parseInt(yearMatch[1], 10) : currentYear;

  // 2. Named Months (e.g. "october", "october month", "november 2026", "mar", "सितंबर")
  for (const [name, monthNum] of Object.entries(MONTH_NAMES_MAP)) {
    const monthRegex = new RegExp(`\\b${name}\\b`, 'i');
    if (monthRegex.test(m)) {
      const monthDisplay = MONTH_DISPLAY_NAMES[monthNum];
      return {
        type: 'month',
        month: monthNum,
        year: targetYear,
        timeframeEn: `${monthDisplay} ${targetYear}`,
        timeframeHi: `${monthDisplay} ${targetYear}`,
        queryParam: `type=monthly&month=${monthNum}&year=${targetYear}`,
        filePrefix: `${monthDisplay}_${targetYear}`
      };
    }
  }

  // 3. Specific Date: YYYY-MM-DD
  const ymdMatch = m.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const mo = String(ymdMatch[2]).padStart(2, '0');
    const d = String(ymdMatch[3]).padStart(2, '0');
    const dateStr = `${y}-${mo}-${d}`;
    return {
      type: 'date',
      timeframeEn: dateStr,
      timeframeHi: dateStr,
      queryParam: `date=${dateStr}`,
      filePrefix: dateStr
    };
  }

  // 4. Specific Date: DD-MM-YYYY
  const dmyMatch = m.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (dmyMatch) {
    const d = String(dmyMatch[1]).padStart(2, '0');
    const mo = String(dmyMatch[2]).padStart(2, '0');
    const y = dmyMatch[3];
    const dateStr = `${y}-${mo}-${d}`;
    return {
      type: 'date',
      timeframeEn: dateStr,
      timeframeHi: dateStr,
      queryParam: `date=${dateStr}`,
      filePrefix: dateStr
    };
  }

  // 5. Specific Date: "15th" or "15 tarikh / tareekh"
  const dayMatch = m.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:tarikh|tareekh|taareekh|tarik)\b/i);
  if (dayMatch) {
    const d = parseInt(dayMatch[1], 10);
    const now = new Date();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    const dateStr = `${targetYear}-${mo}-${dStr}`;
    return {
      type: 'date',
      timeframeEn: dateStr,
      timeframeHi: dateStr,
      queryParam: `date=${dateStr}`,
      filePrefix: dateStr
    };
  }

  // 6. Relative periods
  if (/kal|yesterday/i.test(m)) {
    return {
      type: 'relative',
      timeframeEn: 'Yesterday',
      timeframeHi: 'Kal',
      queryParam: 'date=yesterday',
      filePrefix: 'Yesterday'
    };
  }

  if (/pichl[ae]\s*hafte|last\s*week/i.test(m)) {
    return {
      type: 'relative',
      timeframeEn: 'Last Week',
      timeframeHi: 'Pichle Hafte',
      queryParam: 'date=last_week',
      filePrefix: 'Last_Week'
    };
  }

  if (/(?:is\s*hafte|this\s*week|hafte|week)/i.test(m)) {
    return {
      type: 'relative',
      timeframeEn: 'This Week',
      timeframeHi: 'Is Hafte',
      queryParam: 'date=this_week',
      filePrefix: 'This_Week'
    };
  }

  if (/pichl[ae]\s*mahine?|last\s*month/i.test(m)) {
    return {
      type: 'relative',
      timeframeEn: 'Last Month',
      timeframeHi: 'Pichle Mahine',
      queryParam: 'type=monthly&month=last',
      filePrefix: 'Last_Month'
    };
  }

  if (/(?:full\s*month|this\s*month|is\s*mahine?|pura\s*mahina|pure\s*mahine?|monthly)/i.test(m)) {
    return {
      type: 'relative',
      timeframeEn: 'This Month',
      timeframeHi: 'Pure Mahine',
      queryParam: 'type=monthly&month=this',
      filePrefix: 'Monthly'
    };
  }

  // Default: Today
  return {
    type: 'today',
    timeframeEn: 'Today',
    timeframeHi: 'Aaj',
    queryParam: 'date=today',
    filePrefix: 'Today'
  };
}

/**
 * Smart User Matcher
 * Matches specific user name from companyUsers or database query
 */
async function findTargetUser(m, deps, companyCode) {
  const users = deps?.companyUsers || [];

  // Filter words to ignore false positives
  const IGNORE_WORDS = new Set(['admin', 'user', 'employee', 'sabke', 'all', 'company', 'meri', 'merko', 'mere', 'mujhe', 'my', 'self', 'today', 'tasks', 'task', 'sheet', 'report', 'pdf', 'excel', 'csv']);

  let bestMatch = null;
  let bestScore = 0;

  for (const u of users) {
    const fullName = (u.name || '').trim().toLowerCase();
    if (!fullName || fullName.length < 3) continue;

    // 1. Exact full name match
    if (m.includes(fullName)) {
      if (fullName.length > bestScore) {
        bestMatch = u;
        bestScore = fullName.length;
      }
      continue;
    }

    // 2. Token / First name match
    const parts = fullName.split(/\s+/).filter(p => p.length >= 3 && !IGNORE_WORDS.has(p));
    for (const part of parts) {
      const partRegex = new RegExp(`\\b${part}\\b`, 'i');
      if (partRegex.test(m)) {
        if (part.length > bestScore) {
          bestMatch = u;
          bestScore = part.length;
        }
      }
    }
  }

  if (bestMatch) return bestMatch;

  const isDbConnected = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);

  // 3. Fallback: Query MongoDB if UserModel is available
  if (isDbConnected && UserModel && typeof UserModel.find === 'function' && companyCode) {
    try {
      // Extract candidate names from "mujhe [name] ke task", "[name] task", "give me [name]"
      const candidateMatch = m.match(/(?:for|give\s+me|mujhe|mere\s+ko)?\s*([a-zA-Z]{3,})\s*(?:kai|ke|ki|k)?\s*(?:task|sheet|pdf|report)/i);
      if (candidateMatch && candidateMatch[1]) {
        const candidate = candidateMatch[1].toLowerCase();
        if (!IGNORE_WORDS.has(candidate)) {
          const u = await UserModel.findOne({
            name: { $regex: new RegExp(candidate, 'i') },
            companyCode,
            role: { $not: /^client$/i }
          }).select('_id name email').lean();
          if (u) return u;
        }
      }
    } catch (e) {
      // Ignore DB query errors in edge cases
    }
  }

  return null;
}

/**
 * Smart Client Matcher
 * Matches specific client from accessibleClients or database query
 */
async function findTargetClient(m, deps, companyCode) {
  const clients = deps?.accessibleClients || [];
  const IGNORE_WORDS = new Set(['client', 'cleint', 'master', 'all', 'sheet', 'report', 'tasks', 'task', 'plan', 'plans', 'service', 'services', 'give', 'me', 'karo', 'chahiye']);

  let bestMatch = null;
  let bestScore = 0;

  for (const c of clients) {
    const cName = (c.client || c.name || '').trim().toLowerCase();
    if (!cName || cName.length < 3) continue;

    // 1. Full name match
    if (m.includes(cName)) {
      if (cName.length > bestScore) {
        bestMatch = c;
        bestScore = cName.length;
      }
      continue;
    }

    // 2. Token match (e.g. "saniha" matching "Saniha Enterprises")
    const parts = cName.split(/\s+/).filter(p => p.length >= 3 && !IGNORE_WORDS.has(p));
    for (const part of parts) {
      const partRegex = new RegExp(`\\b${part}\\b`, 'i');
      if (partRegex.test(m)) {
        if (part.length > bestScore) {
          bestMatch = c;
          bestScore = part.length;
        }
      }
    }
  }

  if (bestMatch) return bestMatch;

  const isDbConnected = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);

  // 3. Fallback: Query MongoDB Client model
  if (isDbConnected && ClientModel && typeof ClientModel.findOne === 'function' && companyCode) {
    try {
      const candidateMatch = m.match(/(?:give\s+me|show|export|mujhe)?\s*([a-zA-Z0-9]{3,})\s*(?:client|ki\s*detail|details?)/i);
      if (candidateMatch && candidateMatch[1]) {
        const candidate = candidateMatch[1].toLowerCase();
        if (!IGNORE_WORDS.has(candidate)) {
          const c = await ClientModel.findOne({
            $or: [
              { client: { $regex: new RegExp(candidate, 'i') } },
              { company: { $regex: new RegExp(candidate, 'i') } }
            ],
            companyCode
          }).select('_id client company services activeClientPlan').lean();
          if (c) return c;
        }
      }
    } catch (e) {
      // Ignore DB errors
    }
  }

  return null;
}

/**
 * Smart Project Matcher
 * Matches specific project from accessibleProjects or database query (handles typos like 'netwrok')
 */
async function findTargetProject(m, deps, companyCode) {
  const projects = deps?.accessibleProjects || [];
  const IGNORE_WORDS = new Set(['project', 'projek', 'master', 'all', 'manage', 'sheet', 'report', 'tasks', 'task', 'give', 'me', 'pdf', 'excel', 'csv']);

  // Normalize message (treat netwrok as network)
  const normM = m.replace(/netwrok/gi, 'network');

  let bestMatch = null;
  let bestScore = 0;

  for (const p of projects) {
    const pName = (p.projectName || p.name || '').trim().toLowerCase();
    if (!pName || pName.length < 3) continue;

    // 1. Full name match
    if (normM.includes(pName) || m.includes(pName)) {
      if (pName.length > bestScore) {
        bestMatch = p;
        bestScore = pName.length;
      }
      continue;
    }

    // 2. Token match (e.g. "ciis", "bsk", "homestay", "tender")
    const parts = pName.split(/\s+/).filter(part => part.length >= 3 && !IGNORE_WORDS.has(part));
    for (const part of parts) {
      const partRegex = new RegExp(`\\b${part}\\b`, 'i');
      if (partRegex.test(normM) || partRegex.test(m)) {
        if (part.length > bestScore) {
          bestMatch = p;
          bestScore = part.length;
        }
      }
    }
  }

  if (bestMatch) return bestMatch;

  const isDbConnected = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);

  // 3. Fallback: Query MongoDB Project model
  if (isDbConnected && ProjectModel && typeof ProjectModel.findOne === 'function' && companyCode) {
    try {
      const candidateMatch = normM.match(/(?:give\s+me|show|export|mujhe)?\s*([a-zA-Z0-9\s]{3,})\s*(?:project|ki\s*sheet|tasks?)/i);
      if (candidateMatch && candidateMatch[1]) {
        const candidate = candidateMatch[1].trim();
        if (!IGNORE_WORDS.has(candidate.toLowerCase())) {
          const p = await ProjectModel.findOne({
            projectName: { $regex: new RegExp(candidate, 'i') },
            companyCode
          }).select('_id projectName status managers users').lean();
          if (p) return p;
        }
      }
    } catch (e) {
      // Ignore DB errors
    }
  }

  return null;
}

/**
 * Format chips with user-requested format prioritized
 */
function createDownloadChips({ xlsxUrl, csvUrl, pdfUrl, fileBaseName, isPdfRequested }) {
  const xlsxChip = {
    label: "📥 Download Excel (.xlsx)",
    action: {
      type: "download_report",
      url: xlsxUrl,
      filename: `${fileBaseName}.xlsx`
    }
  };

  const csvChip = {
    label: "📄 Download CSV (.csv)",
    action: {
      type: "download_report",
      url: csvUrl,
      filename: `${fileBaseName}.csv`
    }
  };

  const pdfChip = {
    label: "📕 Download PDF (.pdf)",
    action: {
      type: "download_report",
      url: pdfUrl,
      filename: `${fileBaseName}.pdf`
    }
  };

  // If user explicitly asked for PDF, put PDF first!
  const chips = isPdfRequested
    ? [pdfChip, xlsxChip, csvChip]
    : [xlsxChip, csvChip, pdfChip];

  chips.push({ label: "Main menu", action: { type: "reset" } });
  return chips;
}

async function handleExportRequest({ message, req, deps, currentDraft, isEn }) {
  const m = String(message || '').trim().toLowerCase();
  const companyCode = req?.user?.companyCode || 'CAREER';
  const isPdfRequested = /pdf/i.test(m);
  const dateTodayStr = new Date().toISOString().slice(0, 10);

  const isAttendance = /attend|hazri|हाजिरी|उपस्थिति/i.test(m) || (/sheet/i.test(m) && /ajj|aaj|admin.*sheet/i.test(m) && !/task|client|project/i.test(m));
  const isClientExplicit = /client|cleint|क्लाइंट/i.test(m) || /subscr|expire|kiska\s*plan/i.test(m);
  const isProjectExplicit = /project|projek|प्रोजेक्ट/i.test(m);
  const isTaskExplicit = /task|taks|काम/i.test(m);

  // --------------------------------------------------------------------------
  // 1. ATTENDANCE EXPORT (Supports any Month, Specific Date, Week, User or Company)
  // --------------------------------------------------------------------------
  if (isAttendance) {
    const isSelf = /meri|merko|mere\s*ko|mujhe|my|self/i.test(m) && !/admin|sabki|all|company/i.test(m);
    const tf = extractTimeframe(m);

    // Check if target user was specified (e.g. "kanika ki attendance sheet")
    let targetUser = null;
    if (!isSelf && !/admin|sabki|all|company/i.test(m)) {
      targetUser = await findTargetUser(m, deps, companyCode);
    }

    let userParam = isSelf ? 'type=self' : (targetUser ? `type=user&userId=${targetUser._id || targetUser.id}&userName=${encodeURIComponent(targetUser.name)}` : 'type=all');
    const userLabel = isSelf ? (isEn ? "your Attendance Sheet" : "aapki Attendance Sheet") : (targetUser ? `${targetUser.name} Attendance Sheet` : (isEn ? `Company Attendance Sheet` : `Company Attendance Sheet`));

    const queryJoin = userParam ? `?${userParam}&${tf.queryParam}` : `?${tf.queryParam}`;
    const filePrefix = targetUser ? `${targetUser.name.replace(/\s+/g, '_')}_Attendance_${tf.filePrefix}` : (isSelf ? `My_Attendance_${tf.filePrefix}_${dateTodayStr}` : `Company_Attendance_${tf.filePrefix}_${dateTodayStr}`);

    const reply = isEn
      ? `Here is the ${userLabel} for ${tf.timeframeEn}. You can download it below in PDF, Excel, or CSV format:`
      : `Maine ${tf.timeframeHi} ki ${userLabel} taiyar kar di hai. Aap ise neeche diye gaye format mein download kar sakte hain:`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? `Here is attendance sheet for ${tf.timeframeEn}.` : `${tf.timeframeHi} ki attendance sheet taiyar hai.`,
      speakText: isEn ? `Here is attendance sheet for ${tf.timeframeEn}.` : `${tf.timeframeHi} ki attendance sheet taiyar hai.`,
      draft: currentDraft,
      chips: createDownloadChips({
        xlsxUrl: `/api/export-reports/attendance${queryJoin}&format=xlsx`,
        csvUrl: `/api/export-reports/attendance${queryJoin}&format=csv`,
        pdfUrl: `/api/export-reports/attendance${queryJoin}&format=pdf`,
        fileBaseName: filePrefix,
        isPdfRequested
      }),
      candidates: [],
      notices: []
    };
  }

  // --------------------------------------------------------------------------
  // 2. SPECIFIC CLIENT OR CLIENTS MASTER EXPORT
  // --------------------------------------------------------------------------
  const matchedClient = await findTargetClient(m, deps, companyCode);

  if (matchedClient) {
    const cId = String(matchedClient._id || matchedClient.id);
    const cName = matchedClient.client || matchedClient.name;
    const safeName = cName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const reply = isEn
      ? `Here is the complete report for client "${cName}" including active plans, services, and tasks. Download below:`
      : `Maine client "${cName}" ki sheet taiyar kar di hai jisme active plans, services aur sabhi tasks shamil hain. Download karein:`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? `Report for client ${cName}.` : `Client ${cName} ki report taiyar hai.`,
      speakText: isEn ? `Report for client ${cName}.` : `Client ${cName} ki report taiyar hai.`,
      draft: currentDraft,
      chips: createDownloadChips({
        xlsxUrl: `/api/export-reports/client/${cId}/tasks?format=xlsx`,
        csvUrl: `/api/export-reports/client/${cId}/tasks?format=csv`,
        pdfUrl: `/api/export-reports/client/${cId}/tasks?format=pdf`,
        fileBaseName: `Client_${safeName}_Report_${dateTodayStr}`,
        isPdfRequested
      }),
      candidates: [],
      notices: []
    };
  }

  // If no specific client was found, check if it's a general Client Master / Overview query
  if (isClientExplicit) {
    const isClientTaskPrompt = /tasks?|काम/i.test(m) && !/master|overview|subscr|expire|kiska|all/i.test(m);
    if (isClientTaskPrompt) {
      const clients = deps?.accessibleClients || [];
      const reply = isEn
        ? "Which client's tasks would you like to export? Please select a client below:"
        : "Aap kis client ke tasks export karna chahte hain? Kripya client select karein:";
      const clientChips = (clients.slice(0, 6) || []).map(c => ({
        label: `${isPdfRequested ? '📕 ' : '📥 '}${c.client || c.name}${isPdfRequested ? ' (PDF)' : ''}`,
        action: {
          type: "download_report",
          url: `/api/export-reports/client/${c._id || c.id}/tasks?format=${isPdfRequested ? 'pdf' : 'xlsx'}`,
          filename: `Client_${c.client || c.name}_Tasks_${dateTodayStr}.${isPdfRequested ? 'pdf' : 'xlsx'}`
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

    const reply = isEn
      ? "Here is the Clients & Subscriptions Master Sheet. It includes client status, plan name, expiry date, total tasks, and active services list:"
      : "Maine Clients Master Sheet taiyar kar di hai. Isme sabhi clients ka subscription status, expiry date, total tasks aur assigned services ki poori jaankari hai:";

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? "Here is the clients master sheet." : "Clients master sheet taiyar hai.",
      speakText: isEn ? "Here is the clients master sheet." : "Clients master sheet taiyar hai.",
      draft: currentDraft,
      chips: createDownloadChips({
        xlsxUrl: `/api/export-reports/clients-master?format=xlsx`,
        csvUrl: `/api/export-reports/clients-master?format=csv`,
        pdfUrl: `/api/export-reports/clients-master?format=pdf`,
        fileBaseName: `Clients_Master_Report_${dateTodayStr}`,
        isPdfRequested
      }),
      candidates: [],
      notices: []
    };
  }

  // --------------------------------------------------------------------------
  // 3. SPECIFIC PROJECT OR PROJECTS MASTER EXPORT
  // --------------------------------------------------------------------------
  const isProjectsMaster = isProjectExplicit && /manage\s*project|all\s*project|projects?\s*master|projects?\s*(?:summary|overview|list|report|sheet)|kitne\s*project/i.test(m);
  const matchedProject = !isProjectsMaster ? await findTargetProject(m, deps, companyCode) : null;

  if (matchedProject) {
    const pId = String(matchedProject._id || matchedProject.id);
    const pName = matchedProject.projectName || matchedProject.name;
    const safeName = pName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const reply = isEn
      ? `Here is the tasks and members report for project "${pName}". Download below:`
      : `Maine project "${pName}" ke sabhi tasks aur team details ki report taiyar kar di hai. Download karein:`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? `Project ${pName} tasks report.` : `Project ${pName} ke tasks ki sheet taiyar hai.`,
      speakText: isEn ? `Project ${pName} tasks report.` : `Project ${pName} ke tasks ki sheet taiyar hai.`,
      draft: currentDraft,
      chips: createDownloadChips({
        xlsxUrl: `/api/export-reports/project/${pId}/tasks?format=xlsx`,
        csvUrl: `/api/export-reports/project/${pId}/tasks?format=csv`,
        pdfUrl: `/api/export-reports/project/${pId}/tasks?format=pdf`,
        fileBaseName: `Project_${safeName}_Tasks_${dateTodayStr}`,
        isPdfRequested
      }),
      candidates: [],
      notices: []
    };
  }

  if (isProjectExplicit) {
    if (isProjectsMaster) {
      const reply = isEn
        ? "Here is the Company Projects Master Sheet with project statuses, managers, team members, task counts, and progress rates:"
        : "Maine Company Projects Master Sheet taiyar kar di hai. Isme sabhi projects ka status, manager, team members, total tasks, completed tasks aur progress % shamil hai:";

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Here is the projects master sheet." : "Projects master sheet taiyar hai.",
        speakText: isEn ? "Here is the projects master sheet." : "Projects master sheet taiyar hai.",
        draft: currentDraft,
        chips: createDownloadChips({
          xlsxUrl: `/api/export-reports/projects-master?format=xlsx`,
          csvUrl: `/api/export-reports/projects-master?format=csv`,
          pdfUrl: `/api/export-reports/projects-master?format=pdf`,
          fileBaseName: `Projects_Master_Report_${dateTodayStr}`,
          isPdfRequested
        }),
        candidates: [],
        notices: []
      };
    } else {
      // Suggest project selection chips
      const projects = deps?.accessibleProjects || [];
      const reply = isEn
        ? "Which project's tasks would you like to export? Please choose a project:"
        : "Aap kis project ke tasks export karna chahte hain? Kripya project chunein:";
      const projChips = (projects.slice(0, 6) || []).map(p => ({
        label: `${isPdfRequested ? '📕 ' : '📥 '}${p.projectName || p.name}${isPdfRequested ? ' (PDF)' : ''}`,
        action: {
          type: "download_report",
          url: `/api/export-reports/project/${p._id || p.id}/tasks?format=${isPdfRequested ? 'pdf' : 'xlsx'}`,
          filename: `Project_${p.projectName || p.name}_Tasks_${dateTodayStr}.${isPdfRequested ? 'pdf' : 'xlsx'}`
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

  // --------------------------------------------------------------------------
  // 4. TASKS EXPORT (Specific User Tasks, All Tasks, or Self Tasks)
  // --------------------------------------------------------------------------
  if (isTaskExplicit || /sheet|report/i.test(m)) {
    const isAll = /sabke|all|company.*tasks?|company\s*wide/i.test(m);
    const targetUser = await findTargetUser(m, deps, companyCode);

    if (isAll) {
      const reply = isEn
        ? "Here is the Tasks Report for all company users. You can download the full spreadsheet below:"
        : "Ye rahi sabhi company users ke tasks ki sheet. Aap ise PDF ya Excel format mein download kar sakte hain:";

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? "Here is the company-wide tasks sheet." : "Sabhi tasks ki sheet taiyar hai.",
        speakText: isEn ? "Here is the company-wide tasks sheet." : "Sabhi tasks ki sheet taiyar hai.",
        draft: currentDraft,
        chips: createDownloadChips({
          xlsxUrl: `/api/export-reports/tasks?type=all&format=xlsx`,
          csvUrl: `/api/export-reports/tasks?type=all&format=csv`,
          pdfUrl: `/api/export-reports/tasks?type=all&format=pdf`,
          fileBaseName: `All_Tasks_${dateTodayStr}`,
          isPdfRequested
        }),
        candidates: [],
        notices: []
      };
    }

    if (targetUser) {
      const uName = targetUser.name;
      const safeUName = uName.replace(/\s+/g, '_');
      const reply = isEn
        ? `Here is the tasks report for ${uName}. Download below:`
        : `Maine ${uName} ke tasks ki sheet taiyar kar di hai. Download karne ke liye neeche click karein:`;

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply,
        speech: isEn ? `Tasks sheet for ${uName}.` : `${uName} ke tasks ki sheet taiyar hai.`,
        speakText: isEn ? `Tasks sheet for ${uName}.` : `${uName} ke tasks ki sheet taiyar hai.`,
        draft: currentDraft,
        chips: createDownloadChips({
          xlsxUrl: `/api/export-reports/tasks?type=user&userName=${encodeURIComponent(uName)}&userId=${targetUser._id || targetUser.id}&format=xlsx`,
          csvUrl: `/api/export-reports/tasks?type=user&userName=${encodeURIComponent(uName)}&userId=${targetUser._id || targetUser.id}&format=csv`,
          pdfUrl: `/api/export-reports/tasks?type=user&userName=${encodeURIComponent(uName)}&userId=${targetUser._id || targetUser.id}&format=pdf`,
          fileBaseName: `${safeUName}_Tasks_${dateTodayStr}`,
          isPdfRequested
        }),
        candidates: [],
        notices: []
      };
    }

    // Default to Self Tasks
    const isToday = /aaj|ajj|today/i.test(m);
    const userLabel = isToday ? "Today's Tasks" : "User Tasks";
    const queryParams = `type=self${isToday ? '&date=today' : ''}`;

    const reply = isEn
      ? `Here is your tasks sheet. Download below:`
      : `Maine aapki tasks sheet taiyar kar di hai. Neeche diye button se download karein:`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply,
      speech: isEn ? "Your tasks sheet is ready." : "Aapki tasks sheet taiyar hai.",
      speakText: isEn ? "Your tasks sheet is ready." : "Aapki tasks sheet taiyar hai.",
      draft: currentDraft,
      chips: createDownloadChips({
        xlsxUrl: `/api/export-reports/tasks?${queryParams}&format=xlsx`,
        csvUrl: `/api/export-reports/tasks?${queryParams}&format=csv`,
        pdfUrl: `/api/export-reports/tasks?${queryParams}&format=pdf`,
        fileBaseName: `${userLabel.replace(/\s+/g, '_')}_${dateTodayStr}`,
        isPdfRequested
      }),
      candidates: [],
      notices: []
    };
  }

  return null;
}

module.exports = {
  isExportQuery,
  extractTimeframe,
  handleExportRequest
};
