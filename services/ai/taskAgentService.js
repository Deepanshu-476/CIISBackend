
function getPendingSlotQuestion(intent, slot, lang = 'hinglish') {
  const isEn = lang === 'en';
  if (isEn) {
    if (intent === 'create_client_plan') {
      if (slot === 'name') return 'What should be the plan name? (e.g. "Gold Plan", "Basic Plan"):';
      if (slot === 'price') return 'What is the plan price (in ₹)?';
      if (slot === 'months') return 'What is the plan duration in months? (e.g. 1, 3, 6, 12):';
      if (slot === 'status') return 'What should be the plan status? Active or Inactive?';
      if (slot === 'description') return 'What is the plan description? (You can say "Skip" if none):';
      if (slot === 'services') return 'Which services should be included in this plan? Select services and click "Done":';
    }
    if (intent === 'create_client') {
      if (slot === 'client') return 'Please provide the client name (required):';
      if (slot === 'company') return 'Please provide the company name (required):';
      if (slot === 'city') return 'Please provide the city name (required):';
      if (slot === 'email') return 'Please provide the client email address (required):';
      if (slot === 'status') return 'What should be the client status? (Active, On Hold, Inactive):';
      if (slot === 'projectManager' || slot === 'team') return 'Please specify the team member who will manage this client:';
      if (slot === 'clientPlan' || slot === 'plan') return 'Which plan would you like to assign to this client? Select a plan, or create a new plan:';
      if (slot === 'services') return 'Which services would you like to provide to this client?';
      if (slot === 'subscriptionStartDate') return 'Please provide the subscription start date:';
    }
    if (intent === 'create_project') {
      if (slot === 'name') return 'Please provide the project name (required):';
      if (slot === 'startDate') return 'What is the project start date?';
      if (slot === 'endDate') return 'What is the project end date?';
      if (slot === 'members') return 'Select project members:';
    }
    if (intent === 'task_project') {
      if (slot === 'project') return 'Which project should the task be added to?';
      if (slot === 'title') return 'What should be the task title?';
      if (slot === 'assignee') return 'Who should this task be assigned to?';
    }
    if (intent === 'create_client_task') {
      if (slot === 'client') return 'Which client is this task for?';
      if (slot === 'service') return 'Which service is this task under?';
      if (slot === 'assignee') return 'Who should this task be assigned to?';
      if (slot === 'title') return 'What is the task title?';
    }
    if (slot === 'assignee') return 'Who should this task be assigned to?';
    if (slot === 'title') return 'What should be the task title?';
    if (slot === 'dueDateTime' || slot === 'dueDate') return 'What is the due date and time?';
    return 'Please provide the next detail:';
  }

  if (intent === 'create_client_plan') {
    if (slot === 'name') return 'Plan ka naam kya rakhna hai? (Jaise "Gold Plan", "Basic Plan"):';
    if (slot === 'price') return 'Plan ka price (₹ mein) kitna hoga?';
    if (slot === 'months') return 'Plan ki duration kitne mahine (months) hogi? (Jaise 1, 3, 6, 12):';
    if (slot === 'status') return 'Plan ka status kya rakhna hai? Active ya Inactive?';
    if (slot === 'description') return 'Plan ka description kya likhna hai? Agar nahi likhna toh "Skip" kar sakte hain:';
    if (slot === 'services') return 'Is plan mein kaun si services shamil karni hain? Services chunein aur "Done" dabayein:';
  }

  if (intent === 'create_client') {
    if (slot === 'client') return 'Client ka naam batayein (zaroori hai):';
    if (slot === 'company') return 'Company ka naam batayein (zaroori hai):';
    if (slot === 'city') return 'City ka naam batayein (zaroori hai):';
    if (slot === 'email') return 'Client ka email address batayein (zaroori hai):';
    if (slot === 'status') return 'Client ka status kya rakhna hai? (Active, On Hold, Inactive):';
    if (slot === 'projectManager' || slot === 'team') return 'Team member ka naam batayein jo is client ko manage karenge:';
    if (slot === 'clientPlan' || slot === 'plan') return 'Client ke liye kaun sa plan lagana hai? Plan chunein, ya naya plan banayein:';
    if (slot === 'services') return 'Is client ko kaun si services deni hain?';
    if (slot === 'subscriptionStartDate') return 'Subscription start date batayein:';
  }
  if (intent === 'create_project') {
    if (slot === 'name') return 'Project ka naam batayein (zaroori hai):';
    if (slot === 'startDate') return 'Start date kya hogi?';
    if (slot === 'endDate') return 'End date kya hogi?';
    if (slot === 'members') return 'Project members chunein:';
  }
  if (intent === 'task_project') {
    if (slot === 'project') return 'Kaun se project mein task banana hai?';
    if (slot === 'title') return 'Task ka naam kya hoga?';
    if (slot === 'assignee') return 'Task kisse assign karna hai?';
  }
  if (intent === 'create_client_task') {
    if (slot === 'client') return 'Kaun se client ke liye task banana hai?';
    if (slot === 'service') return 'Kaun si service ka task banana hai?';
    if (slot === 'assignee') return 'Task kisse assign karna hai?';
    if (slot === 'title') return 'Task title batayein:';
  }
  if (slot === 'assignee') return 'Task kisse assign karna hai?';
  if (slot === 'title') return 'Task ka naam kya hoga?';
  if (slot === 'dueDateTime' || slot === 'dueDate') return 'Due date aur time kya hoga?';
  return 'Agli detail batayein:';
}

const mongoose = require('mongoose');
const { extractTaskDraft, mergeDraft } = require('./taskExtractor');
const { getScopeInfo, isAssigneeInScope } = require('./taskScope');
const { resolveAssignee, escapeRegex } = require('./assigneeResolver');
const { getModelName } = require('./llm');
const { answerWithGroqCRM } = require('./groqCrmHelper');
const { TASK_FIELDS, TASK_FIELD_ORDER } = require('./taskFields');
const { parseHinglishSlots, isSkip, isSkipAll, isSelfPhrase, isFillerPhrase, extractAssigneeMention, extractMultipleAssignees, isInvalidOrCommandTitle, cleanAssigneeName, isValidAssigneeCandidate, detectPersonInActionTitle, parseCheckpointItems } = require('./hinglishParser');
const { detectUserIntent, normalizeTranscript } = require('./sttNormalizer');
const User = require('../../models/User');
const Department = require('../../models/Department');
const SidebarConfig = require('../../models/SidebarConfig');
const ClientTask = require('../../HR-CDS/models/ClientTask');
const Client = require('../../HR-CDS/models/Client');
const ClientPlan = require('../../HR-CDS/models/ClientPlan');
const { Project: DefaultProjectModel } = require('../../HR-CDS/models/Project');
const {
  resolveProject,
  resolveProjectAssignee,
  getAccessibleProjects,
  buildProjectCandidateChips,
  buildAccessibleProjectChips,
  formatCandidateDate,
  requiresProjectDistinguishing,
  hasProjectAccess,
  idsEqual,
  phoneticNormalize,
} = require('./projectResolver');

const {
  FORM_REGISTRY,
  detectIntent,
  migrateDraftBetweenIntents,
  getIntentSlots,
  checkIntentAccess,
  formatHumanIstDate,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getReminderPreviewText,
  formatProjectPriority,
  formatProjectStatus,
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
} = require('./formRegistry'); const { buildChips, assertChipsAllowed, FLOW_FIRST_QUESTION_HINTS, formatMemberChipLabel, getCleanDepartment } = require('./formRegistry');

const {
  createLedger,
  mergeIntoLedger,
  syncAssigneeLedgerDerivedFields,
  isAssigneeLedgerComplete,
  getFirstUnresolvedLedgerEntry,
  evaluateLedgerEntry,
  updateLedgerWithPick,
  removeLedgerEntry,
  buildUnresolvedEntryPrompt,
} = require('./assigneeLedger');

const {
  formatIstDate,
  extractCreateProjectSlotsFromMessage,
  parseProjectDate,
  findDuplicateProject,
} = require('./projectSlotFiller');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getIstDateShifted(d = new Date()) {
  return new Date(d.getTime() + INDIA_OFFSET_MS);
}

function hasExplicitFieldEditIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase();
  if (/(?:title|naam|नाम|description|विवरण|डिस्क्रिप्शन|priority|प्रायोरिटी|status|स्टेटस|due|baje|बजे|time|samay|समय|date|tarikh|tareekh|तारीख|minute|min|मिनट|hour|ghanta|घंटा|reminder|रिमाइंडर|checkpoints|चेकपॉइंट|assign|project)/iu.test(clean)) {
    return true;
  }
  if (/(?:badlo|badal|change|बदलो|बदल|set\s+karo|rakho|रखो)/iu.test(clean)) {
    return true;
  }
  if (/(?<![\p{L}\p{M}])(?:kal|कल|aaj|आज|tomorrow|today)(?![\p{L}\p{M}])/iu.test(clean)) {
    return true;
  }
  return false;
}

const INTENT_NAMES_HI = {
  self_task: 'Personal task',
  task_assigned_user: 'Kisi aur ko task assign karna',
  create_project: 'Project create karna',
  task_project: 'Project mein task banana',
  create_client: 'Client add karna',
  create_client_plan: 'Client plan banana',
  create_client_task: 'Client ke liye task banana',
};

function getWelcomeMessage(user, now = new Date(), lang = 'en') {
  const rawName = String(user?.name || user?.userName || '').trim();
  const firstName = rawName ? rawName.split(/\s+/)[0] : '';
  const istDate = getIstDateShifted(now);
  const hours = istDate.getUTCHours();
  let salutationEn = 'Good morning';
  let salutationHi = 'गुड मॉर्निंग';
  if (hours >= 12 && hours < 17) {
    salutationEn = 'Good afternoon';
    salutationHi = 'गुड आफ्टरनून';
  } else if (hours >= 17) {
    salutationEn = 'Good evening';
    salutationHi = 'गुड इवनिंग';
  }

  if (!firstName) {
    if (lang === 'hinglish') {
      return {
        reply: 'Namaste! Main CIIS AI Assistant hoon. Aap kya karna chahte hain?',
        speech: 'नमस्ते! मैं सी आई आई एस ए आई असिस्टेंट हूँ। आप क्या करना चाहते हैं?',
        speakText: 'Namaste! Main CIIS AI Assistant hoon. Aap kya karna chahte hain?',
        speakTextHi: 'नमस्ते! मैं सी आई आई एस ए आई असिस्टेंट हूँ। आप क्या करना चाहते हैं?',
      };
    }
    const replyEn = `${salutationEn}! I am your CIIS AI Assistant. What would you like to do today?`;
    return {
      reply: replyEn,
      speech: replyEn,
      speakText: replyEn,
      speakTextHi: 'नमस्ते! मैं सी आई आई एस ए आई असिस्टेंट हूँ। आप क्या करना चाहते हैं?',
    };
  }

  const capitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  if (lang === 'hinglish') {
    const reply = `${salutationEn} ${capitalized}! Aap aaj kya karna chahte hain?`;
    const speech = `${salutationHi} ${capitalized}! आप आज क्या करना चाहते हैं?`;
    return {
      reply,
      speech,
      speakText: reply,
      speakTextHi: speech,
    };
  }

  const replyEn = `${salutationEn} ${capitalized}! What would you like to do today?`;
  return {
    reply: replyEn,
    speech: replyEn,
    speakText: replyEn,
    speakTextHi: `${salutationHi} ${capitalized}! आप आज क्या करना चाहते हैं?`,
  };
}

function detectMessageLanguage(text, fallback = 'hinglish') {
  if (!text || typeof text !== 'string') return fallback;
  const clean = text.trim();
  if (/[\u0900-\u097F]/.test(clean)) return 'hinglish';
  const hinglishMarker = /\b(?:aap|ap|mera|meri|mere|mujhe|hamara|hum|kya|kaun|kon|kaunsi|kab|kahan|kaise|kese|kyun|kisko|kisse|kitne|kitna|hai|hain|ho|hoon|hun|tha|thi|kar|karo|karna|kariye|banao|banayein|batao|batayein|dikhao|dikhayein|rakho|rakh|hoga|hogi|dena|dijiye|chahiye|chahiyein|raha|rahi|rahe|aur|ya|ke|ki|ka|ko|mein|main|liye|saath|bhi|nahi|nhi|mat|badhiya|shukriya|theek|thik|dhanyawad|kaam|kardo|karwao|aaj|aj|kal|kl|cal|parso|shaam|sham|subah|subha|dopahar|raat|baje|tarikh|pehle|baad|hona|wale|wali|wala|kisi|dusre|apna|apne|apni|khud|ek|do|teen|chaar|panch|banado|dalo|likho|chhod|sab|baaki|kuch|koi)\b/i;
  if (hinglishMarker.test(clean)) return 'hinglish';
  const englishWords = clean.match(/\b[a-zA-Z]{2,}\b/g) || [];
  if (englishWords.length > 0) {
    return 'en';
  }
  return fallback;
}

const CHIT_CHAT_GREETINGS = [
  /^(?:gud|good)?\s*(?:morning|afternoon|evening|night)\b/i,
  /^(?:hi+|he+y+|hello+|namaste+|namaskar+|pranam+|salaam+|wassup|sup)\b/i,
  /\b(?:how\s+(?:are|r)\s+u|how\s+are\s+you|how\s+is\s+it\s+going|how's\s+it\s+going|how\s+do\s+you\s+do)\b/i,
  /\b(?:kaise\s+ho|kya\s+haal\s+hai|kaisa\s+hai|sab\s+theek\s+hai|sab\s+kaisa\s+hai)\b/i,
  /\b(?:who\s+are\s+you|tum\s+kaun\s+ho|aap\s+kaun\s+hai[n]?|tumhara\s+naam\s+kya\s+hai|aapka\s+naam\s+kya\s+hai)\b/i,
  /\b(?:what\s+can\s+you\s+do|tum\s+kya\s+kar\s+sakte\s+ho|aap\s+kya\s+kar\s+sakte\s+hai[n]?|kya\s+kya\s+kar\s+sakte\s+ho|help|madad|features|commands)\b/i,
  /\b(?:thanks?|thank\s+you|thanku|dhanyawad|shukriya|so\s+nice|bahut\s+achha|bahut\s+khoob|nice|great|awesome|badhiya)\b/i,
  /\b(?:bye|goodbye|alvida|see\s+you|tata|chalta\s+hoon|phir\s+milenge)\b/i,
  /\b(?:mood|bhuut\s+kush|bohot\s+khush|kush\s+hu|khush\s+hu|bhuut\s+asha|bahut\s+achha|feeling\s+happy|feeling\s+good|feeling\s+great|feeling)\b/i,
  /\b(?:tired|so\s+tired|fell\s+tired|feel\s+tired|feeling\s+tired|exhausted|sleepy|lazy|bored|boring|stressed|tension|thak\s+gaya|thak\s+gayi|thakan|neend|sad|upset|low)\b/i,
];

function isChitChatOrGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (isCrmQuery(clean)) return false;
  const hasTaskOrCrmDetails = /\b(?:task\s+banao|task\s+create|task\s+naam|task\s+name|task\s+title|description|priority|assign\s+karo|assign\s+to|task\s+do|project\s+banao|naya\s+project|client\s+add|client\s+banao|meeting\s+rakh)\b/i.test(clean);
  if (hasTaskOrCrmDetails) return false;
  return CHIT_CHAT_GREETINGS.some(rx => rx.test(clean));
}

function getChitChatReply(text, user, now = new Date(), lang = 'hinglish') {
  const isEn = lang === 'en';
  const rawName = String(user?.name || user?.userName || '').trim();
  const firstName = rawName ? rawName.split(/\s+/)[0] : '';
  const capitalized = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : '';

  const istDate = getIstDateShifted(now);
  const hours = istDate.getUTCHours();
  let salutation = 'Good morning';
  if (hours >= 12 && hours < 17) salutation = 'Good afternoon';
  else if (hours >= 17) salutation = 'Good evening';

  const clean = String(text || '').trim().toLowerCase();

  // Mood / Feelings (e.g. "gud morning aj mera mood bhuut asha hai aj mai bhuut kush hu")
  if (/\b(?:mood|bhuut\s+kush|bohot\s+khush|kush\s+hu|khush\s+hu|bhuut\s+asha|bahut\s+achha|happy|feeling)\b/i.test(clean)) {
    if (isEn) {
      const rep = `${salutation}${capitalized ? ' ' + capitalized : ''}! That's wonderful to hear, so glad you're feeling great today! 😊 How can I assist you with your tasks, projects, or clients today?`;
      return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
    }
    const rep = `${salutation}${capitalized ? ' ' + capitalized : ''}! Ye sunkar bahut achha laga ki aapka mood itna achha hai aur aap khush hain! 😊 Aaj CRM mein tasks, projects ya clients mein kya kaam shuru karein?`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }

  // Physical states / Tired / Low / Stressed (e.g. "today i fell so tired", "aj mai thak gaya")
  if (/\b(?:tired|fell\s+tired|feel\s+tired|feeling\s+tired|exhausted|sleepy|lazy|bored|boring|stressed|tension|thak\s+gaya|thak\s+gayi|thakan|neend|sad|upset|low)\b/i.test(clean)) {
    if (isEn) {
      const rep = `Please take a short break and rest a bit${capitalized ? ', ' + capitalized : ''}! 😊 Don't push yourself too hard. Whenever you feel refreshed, let me know how I can help with your CRM tasks or projects.`;
      return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
    }
    const rep = `Aap thoda aaram kijiye aur paani pijiye${capitalized ? ', ' + capitalized : ''}! 😊 Jyada stress mat lijiye. Jab aap better feel karein, tab batayein CRM mein kya kaam shuru karna hai.`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }

  // Who are you / What can you do
  if (/(?:who\s+are\s+you|tum\s+kaun\s+ho|aap\s+kaun|what\s+can\s+you\s+do|tum\s+kya\s+kar\s+sakte|aap\s+kya)/i.test(clean)) {
    if (isEn) {
      const rep = `I am your CIIS AI Assistant! I can help you create and manage tasks, track projects, look up clients, and query your workload. What would you like to work on today?`;
      return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
    }
    const rep = `Main CIIS AI Assistant hoon! Main aapke tasks create/manage karne, projects dekhne, clients add karne aur aapka kaam track karne mein madad karta hoon. Aaj kya karna chahte hain?`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }

  // Thanks / Gratitude
  if (/(?:thanks|thank\s+you|thanku|dhanyawad|shukriya)/i.test(clean)) {
    if (isEn) {
      const rep = `You're very welcome${capitalized ? ' ' + capitalized : ''}! Let me know if you need help with anything else in your CRM.`;
      return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
    }
    const rep = `Aapka swagat hai${capitalized ? ' ' + capitalized : ''}! CRM mein kisi bhi kaam ke liye main hamesha yahan hoon.`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }

  // Bye
  if (/(?:bye|goodbye|alvida|tata)/i.test(clean)) {
    if (isEn) {
      const rep = `Goodbye${capitalized ? ' ' + capitalized : ''}! Have a productive day ahead!`;
      return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
    }
    const rep = `Alvida${capitalized ? ' ' + capitalized : ''}! Aapka din shubh aur productive rahe!`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }

  // General greeting / How are you (e.g. "gud morning , how are u")
  if (isEn) {
    const rep = `${salutation}${capitalized ? ' ' + capitalized : ''}! I'm doing great, thank you! How can I assist you with your tasks, projects, or clients today?`;
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }
  const rep = `Main badhiya hoon${capitalized ? ' ' + capitalized : ''}, poochne ke liye shukriya! Aap bataiye, aaj CRM mein tasks, projects ya clients mein kya madad karoon?`;
  return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
}

const OUT_OF_SCOPE_REGEX = /(?:(?:\b(?:fever|bukhar|bimar|medicine|dawai|tablet|headache|sir\s+dard|pet\s+dard|doctor|treatment|cure|hospital|bimari)\b)|(?:\b(?:capital\s+of|prime\s+minister|pm\s+of|who\s+is\s+the\s+pm|president|chief\s+minister|pradhan\s+mantri|current\s+weather|aaj\s+ka\s+mausam|temperature|cricket|ipl|who\s+won|movie|film|song|gana|recipe|khana\s+kaise|tea|coffee|chai|how\s+to\s+make|chutkula|tell\s+me\s+a\s+joke)\b)|(?:\b(?:write\s+(?:a\s+)?python|write\s+(?:a\s+)?code|write\s+(?:a\s+)?script|fibonacci|solve\s+math|quantum|stock\s+market|crypto|bitcoin|horoscope|rashifal)\b))/i;

function isOutOfScopeQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  const hasCrmContext = /(?:task|taks|project|projek|client|cleint|service|priority|status|assign|lead|company|crm|meeting|deadline|due|banao|kardo|update|edit|add)/i.test(clean);
  if (hasCrmContext) return false;
  const isGeneralKnowledgeQuestion = /^(?:tell\s+me|who\s+is|who\s+was|who\s+are|what\s+is|what\s+are|what\s+was|how\s+to|how\s+do|where\s+is|why\s+is|why\s+do|when\s+did|which\s+is|can\s+you\s+(?:tell|explain|cook|sing|dance|write|solve|make|teach))\b/i.test(clean) || /(?:kaise\s+(?:banayein|banta|banti|banaye|karein)|kaun\s+hai|kya\s+hai|kahan\s+hai)\b/i.test(clean);
  return OUT_OF_SCOPE_REGEX.test(clean) || isGeneralKnowledgeQuestion;
}

function getOutOfScopeReply(text, user, lang = 'hinglish') {
  if (lang === 'en') {
    const rep = 'I am your CIIS CRM Assistant and can only assist with your company tasks, projects, and clients. I cannot answer medical, general knowledge, or off-topic questions. How can I help you with your CRM work today?';
    return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
  }
  const rep = 'Main aapka CIIS CRM Assistant hoon aur sirf aapke CRM tasks, projects aur clients mein madad kar sakta hoon. Main dawai, general knowledge ya bahar ke sawaalon ka jawab nahi de sakta. Aaj aapke CRM kaam mein kya madad karoon?';
  return { reply: rep, speech: rep, speakText: rep, speakTextHi: rep };
}

const CRM_PROJECTS_QUERY_REGEX = /(?:(?:projects?|projekts?|projets?|प्रोजेक्ट्स?|प्रजेक्ट|प्रोज़ेक्ट).*(?:\?|kitne|kitna|how\s+many|kon|kaun|which|what|list|dikhao|batao|tell|show|status|hai|hain|chal\s+rahe|have|i\s+have|कितने|इतने|दिखाओ|बताओ|हैं)|(?:\?|kitne|kitna|how\s+many|kon\s+se|kaun\s+se|which|what|list|dikhao|batao|tell\s+me|tell|show|mere|apne|active|all|crm\s+ma?i|crm\s+mein|कितने|इतने|चेक|check).*(?:projects?|projekts?|projets?|प्रोजेक्ट्स?|प्रजेक्ट|प्रोज़ेक्ट))/iu;
const CRM_CLIENTS_QUERY_REGEX = /(?:(?:clients?|cleints?|clints?|क्लाइंट्स?|क्लाइज|क्लाइन्स|क्लाइंट|क्लायंट).*(?:\?|kitne|kitna|kidney|how\s+many|kon|kaun|which|what|list|dikhao|batao|tell|show|status|hai|hain|have|i\s+have|कितने|इतने|दिखाओ|बताओ|हैं)|(?:\?|kitne|kitna|kidney|how\s+many|kon\s+se|kaun\s+se|which|what|list|dikhao|batao|tell\s+me|tell|show|mere|apne|active|all|crm\s+ma?i|crm\s+mein|कितने|इतने|चेक|check).*(?:clients?|cleints?|clints?|क्लाइंट्स?|क्लाइज|क्लाइन्स|क्लाइंट|क्लायंट))/iu;
const CLIENT_DETAIL_QUERY_REGEX = /(?:(?:services?|सर्विस(?:िस)?|plans?|प्लाइ?न्स?|subscription|details?|जानकारी|status).*(?:di\s+gayi|दी\s+गई|assigned|diya|diye|mil[ie]|hai|hain|kya|kon|kaun|which|batao|dikhao|kaun\s+sa|kon\s+sa|कौन\s*सा|कौन\s*कौन|kisko|uska|uski|inhe|unhe))|(?:(?:kisko|kis\s+client|client|ko|ka|ki|को|का|की).*(?:services?|सर्विस(?:िस)?|plans?|प्लाइ?न्स?).*(?:di\s+gayi|दी\s+गई|assigned|diya|diye|mil[ie]|hai|hain|kya|kon|kaun|batao|dikhao|details?))|(?:(?:services?|सर्विस(?:िस)?|plans?|प्लाइ?न्स?)\s+(?:aur|and|ya|or)\s+(?:services?|सर्विस(?:िस)?|plans?|प्लाइ?न्स?))/iu;
const CRM_TASKS_QUERY_REGEX = /(?:(?:tasks?|taks|tasak|taask|tsk|kaam|work|टास्क|काम).*(?:\?|kon|kaun|konsa|kaunsa|konsi|kaunsi|kya|which|what|list|dikhao|batao|tell|show|status|kitne|kitna|how\s+many|check|hai|hain|hia|chal\s+raha|कितने|इतने|दिखाओ|बताओ)|(?:\?|check|batao|batayein|dikhao|tell|show|kon|kaun|konsa|kaunsa|konsi|kaunsi|kya|which|what|kitne|kitna|how\s+many|abhi\s+mera|mere|apne|my|aaj\s+ke|कितने|इतने|चेक).*(?:tasks?|taks|tasak|taask|tsk|kaam|work|टास्क|काम)|(?:in[- ]progress|pending|overdue|completed).*(?:tasks?|taks|tasak|taask|tsk|kaam|work|टास्क|काम|\?|hai|hain|hia|chal\s+raha)|(?:tasks?|taks|tasak|taask|tsk|kaam|work|टास्क|काम).*(?:in[- ]progress|pending|overdue|completed)|(?:check|batao|dikhao|tell|kon\s+sa|konsa|kaun\s+sa|kaunsa|kya|चेक|बताओ|दिखाओ).*(?:in[- ]progress|pending|overdue|completed))/iu;
const CRM_TASK_COMPLETE_REGEX = /(?:(?:task|kam)\s*(?:ko\s*)?(?:complete|done|khatam)\s*(?:mark\s*)?(?:karo|kar\s*do|kardo)?|mark\s*(?:task\s*)?(?:as\s*)?(?:complete|done)|(?:complete|done|khatam)\s*(?:mark\s*)?(?:karo|kar\s*do|kardo))/i;
const CRM_TASK_UPDATE_REGEX = /(?:(?:priority|status)\s*(?:ko\s*)?(?:badal\s*kar\s*)?(?:high|low|medium|in[- ]progress|pending|completed?|done|on[- ]?hold|planning|active|cancelled|inactive)|(?:high|low|medium|in[- ]progress|pending|completed?|done|on[- ]?hold|planning|active|cancelled|inactive)\s*(?:priority|status|kardo|kar\s+do|rakho)|(?:priority|status)\s*(?:high|low|medium|in[- ]progress|pending|completed?|done|on[- ]?hold|planning|active|cancelled|inactive)|(?:task|kam|project|client|plan)\s+(?:complete|done|khatam|active|planning|on[- ]?hold|inactive)\s+(?:karo|kar\s+do|mark)|mark\s+(?:task\s+|project\s+|client\s+|plan\s+)?(?:as\s+)?(?:complete|done|active|planning|on[- ]?hold|inactive)|(?:priority|status)\s+(?:update|change|badal|set|make)|(?:kardo|kar\s+do|update|change|badal|set|make).*?(?:priority|status)|(?:status|priority).*?(?:planning|active|completed|high|low|medium|pending|on[- ]?hold|inactive)|(?:make|set|change|put).*?(?:planning|active|on[- ]?hold|inactive)|(?:client|plan).*?(?:on[- ]?hold|active|inactive)\s*(?:kardo|kar\s*do|karo|rakho|set))/iu;
const CRM_TASK_EDIT_REGEX = /(?:edit|badal|change|update).*?(?:task|kam|kaam|description|desc|title|naam|priority|status|assignee|due\s*date)|(?:task|kam|kaam).*?(?:ko\s+)?(?:edit|update|badal|change)/iu;

function findReferencedClient(text, clients = [], draft = null) {
  if (!text || !Array.isArray(clients) || clients.length === 0) return null;
  const lower = text.toLowerCase();

  // PASS 1: Exact / Word-boundary Match on Client Name (highest precedence!)
  // Sort clients by length of name descending so longer names match first
  const sortedByClientName = [...clients].sort((a, b) => {
    const na = (a.client || a.name || '').length;
    const nb = (b.client || b.name || '').length;
    return nb - na;
  });

  for (const c of sortedByClientName) {
    const cName = (c.client || c.name || '').trim();
    if (!cName || cName.length < 2) continue;
    const nameRegex = new RegExp('(?:^|[^a-zA-Z0-9])' + escapeRegex(cName) + '(?:[^a-zA-Z0-9]|$)', 'i');
    if (nameRegex.test(text)) return c;
  }

  // PASS 2: Token match on Client Name (multi-word client names e.g. "Acme Test Client" -> "Acme")
  for (const c of sortedByClientName) {
    const cName = (c.client || c.name || '').trim();
    const tokens = cName.split(/[\s,.-]+/).filter(t => t.length >= 3 && !['solutions', 'pvt', 'ltd', 'inc', 'tech', 'technologies', 'private', 'limited', 'services', 'corp', 'company', 'enterprises', 'group', 'test', 'client'].includes(t.toLowerCase()));
    for (const t of tokens) {
      const reg = new RegExp('(?:^|[^a-zA-Z0-9])' + escapeRegex(t) + '(?:[^a-zA-Z0-9]|$)', 'i');
      if (reg.test(text)) return c;
    }
  }

  // PASS 3: Word-boundary Match on Company Name (excluding generic placeholder words like 'test', 'sample', 'ciis', 'ai')
  const genericCompanyWords = new Set(['test', 'test2', 'demo', 'sample', 'abc', 'xyz', 'company', 'corp', 'solutions', 'technologies', 'services', 'ciis', 'network', 'ai', 'assistant', 'crm', 'testing', 'techsoft']);
  for (const c of clients) {
    const compName = (c.company || '').trim();
    if (!compName || compName.length < 3) continue;
    if (genericCompanyWords.has(compName.toLowerCase())) {
      // For generic words like 'test', only match if user explicitly said "company test" or "test company" or mentions "client"
      const explicitCompanyRegex = new RegExp('(?:company|firm|org|client|cleint)\\s+' + escapeRegex(compName) + '|' + escapeRegex(compName) + '\\s+(?:company|firm|org|client|cleint)', 'i');
      if (explicitCompanyRegex.test(text)) return c;
      continue;
    }
    const compRegex = new RegExp('(?:^|[^a-zA-Z0-9])' + escapeRegex(compName) + '(?:[^a-zA-Z0-9]|$)', 'i');
    if (compRegex.test(text)) return c;
  }

  // PASS 4: Token match on non-generic Company Name
  for (const c of clients) {
    const compName = (c.company || '').trim();
    const tokens = compName.split(/[\s,.-]+/).filter(t => t.length >= 3 && !['solutions', 'pvt', 'ltd', 'inc', 'tech', 'technologies', 'private', 'limited', 'services', 'corp', 'company', 'test', 'demo', 'sample', 'ciis', 'network', 'ai', 'assistant', 'crm', 'testing', 'techsoft'].includes(t.toLowerCase()));
    for (const t of tokens) {
      const reg = new RegExp('(?:^|[^a-zA-Z0-9])' + escapeRegex(t) + '(?:[^a-zA-Z0-9]|$)', 'i');
      if (reg.test(text)) return c;
    }
  }

  // PASS 5: Contextual pronoun references: "esko", "isko", "iska", "iski", "is client", "es client", "this client", "inhe", "unhe", "is wale client"
  const isClientPronoun = /\b(?:is|es|iss|this|same|current|is\s+wale)\s+client\b|\b(?:esko|isko|iska|iski|inhe|unhe|usko|uska|uski)\b/i.test(lower);
  if (draft?.lastClientId) {
    const lastClient = clients.find(c => String(c._id || c.id) === String(draft.lastClientId));
    if (lastClient) {
      if (isClientPronoun) return lastClient;
      // Also match if user mentions any service belonging to this client
      if (Array.isArray(lastClient.services) && lastClient.services.length > 0) {
        const hasServiceMention = lastClient.services.some(s => {
          const sName = (typeof s === 'string' ? s : (s.service || s.name || s.servicename || '')).toLowerCase().trim();
          if (!sName || sName.length < 3) return false;
          return lower.includes(sName);
        });
        if (hasServiceMention) return lastClient;
      }
      // If lastActiveType was client and user didn't mention any project
      if (draft?.lastActiveType === 'client' && !/\b(?:projects?|projekts?)\b/i.test(lower)) {
        if (/(?:tasks?|टास्क|services?|सर्विस|plans?|प्लान|details?|info)/i.test(lower)) {
          return lastClient;
        }
      }
    }
  }

  return null;
}

const PROJECT_COMMON_WORDS = new Set([
  'project', 'projects', 'portal', 'app', 'system', 'network', 'platform',
  'test', 'testing', 'crm', 'dev', 'development', 'design', 'sales', 'marketing',
  'support', 'management', 'ai', 'core', 'new', 'general', 'main', 'basic',
  'admin', 'user', 'service', 'services', 'cloud', 'web', 'data', 'smart',
  'tech', 'software', 'lead', 'client', 'task', 'tasks', 'pipeline', 'workflow',
  'team', 'work', 'code', 'file', 'details', 'name', 'date', 'status', 'priority',
  'plan', 'plans', 'view', 'list', 'create', 'update', 'edit', 'delete', 'page',
  'home', 'dashboard', 'report', 'reports', 'log', 'logs', 'call', 'meeting'
]);

const PROJECT_PRONOUNS = new Set([
  'is', 'es', 'iss', 'this', 'same', 'current', 'wale', 'wala', 'vali', 'us', 'uss', 'that', 'my', 'mera', 'apna', 'ye', 'yeh'
]);

function extractCandidateProjectName(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();

  // Pattern 1: Leading candidate before "project": e.g. "zz ai testing project", "ciis netwrok project"
  const beforeProject = lower.match(/^(?:kya|show|view|check|dikhao|batao|details|please)?\s*([a-z0-9\s_-]{2,40}?)\s+\b(?:projects?|projekts?)\b/i);
  if (beforeProject && beforeProject[1]) {
    const cand = beforeProject[1].trim();
    if (cand && !PROJECT_PRONOUNS.has(cand)) return cand;
    if (PROJECT_PRONOUNS.has(cand)) return null;
  }

  // Pattern 2: "project <candidateName>" where candidate ends before standard prepositions
  const afterProject = lower.match(/\b(?:projects?|projekts?)\s+([a-z0-9\s_-]{2,40}?)(?:\s+(?:ki|ke|ka|ko|se|sai|mein|me|mai|in|on|details|tasks|status|members|full)|$)/i);
  if (afterProject && afterProject[1]) {
    const cand = afterProject[1].trim();
    if (cand && !PROJECT_PRONOUNS.has(cand) && !['naam', 'name', 'list', 'details', 'tasks', 'members'].includes(cand)) {
      return cand;
    }
  }

  return null;
}

function findReferencedProject(text, projects = [], draft = null) {
  if (!text || !Array.isArray(projects) || projects.length === 0) return null;
  const lower = text.toLowerCase();

  // If explicit personal task without "project mein", do NOT match any project!
  const isPersonalTaskPhrase = /\b(?:personal\s+task|self\s+task|mera\s+(?:personal\s+)?task|khud\s+ka\s+task|my\s+task|apna\s+task)\b/i.test(text) ||
    /(?:(?:मेरा|मेरी|मेरे|अपना|अपने|खुद|स्वयं)\s*(?:एक\s*)?(?:नया\s*)?(?:पर्सनल|परशन|स्वयं|खुद)?\s*(?:टास्क|काम))|(?:(?:पर्सनल|परशन)\s*(?:टास्क|काम))/iu.test(text);
  if (isPersonalTaskPhrase && !/\b(?:project\s+mein|in\s+(?:the\s+)?project|project\s+me|ke\s+andar\s+task)\b/i.test(text)) {
    return null;
  }

  const cleanText = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  const candidateName = extractCandidateProjectName(lower);

  // PASS 1: If user explicitly mentioned a candidate name before/after "project":
  // Match candidate specifically against accessible projects!
  if (candidateName) {
    const cleanCand = candidateName.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const candWords = cleanCand.split(/\s+/).filter(Boolean);

    // Exact candidate match
    for (const p of projects) {
      const pName = (p.projectName || p.name || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
      if (pName === cleanCand) return p;
    }

    // Fuzzy candidate match (e.g. "ciis network" vs "ciis netwrok")
    for (const p of projects) {
      const pName = (p.projectName || p.name || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
      const pWords = pName.split(/\s+/).filter(Boolean);
      if (candWords.length === pWords.length) {
        const matchesAll = candWords.every((cw, idx) => {
          const pw = pWords[idx];
          if (cw === pw) return true;
          // 1 character typo tolerance
          if (Math.abs(cw.length - pw.length) <= 1 && (cw.includes(pw.slice(0, 3)) || pw.includes(cw.slice(0, 3)))) return true;
          return false;
        });
        if (matchesAll) return p;
      }
    }

    // Candidate was explicitly specified (e.g. "zz ai agent"), but does NOT match any accessible project!
    // Strict guard: Do NOT fall back to a random project or draft.lastProjectId!
    return null;
  }

  // PASS 2: Check all accessible projects by exact full name in text
  // Sort by length descending so longer/more specific names match first
  const sortedProjects = [...projects].sort((a, b) => (b.projectName || b.name || '').length - (a.projectName || a.name || '').length);

  for (const p of sortedProjects) {
    const pName = (p.projectName || p.name || '').trim().toLowerCase();
    if (!pName || pName.length < 2) continue;
    const cleanP = pName.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
    if (cleanP.length >= 3 && cleanText.includes(cleanP)) {
      return p;
    }
  }

  // PASS 3: Distinctive token match (e.g. "BSK", "TENDER INTELLIGENCE")
  for (const p of sortedProjects) {
    const pName = (p.projectName || p.name || '').trim().toLowerCase();
    const pWords = pName.split(/\s+/).filter(w => w.length >= 3 && !['project', 'the', 'and', 'for', 'platform'].includes(w));
    if (pWords.length === 1 && new RegExp(`\\b${escapeRegex(pWords[0])}\\b`, 'i').test(lower)) {
      return p;
    }
  }

  // PASS 4: Contextual pronoun references: "es project", "is project", "this project", "isme"
  // ONLY if user did not specify an unknown project candidate
  const hasPronoun = /\b(?:is|es|iss|this|same|current|is\s+wale)\s+project\b|\bisme\b/i.test(lower);
  const mentionsProjectWord = /\b(?:projects?|projekts?)\b/i.test(lower);
  const isGenericFollowup = /(?:^|\s)(?:check\s+project\s+details|project\s+details|view\s+project|view\s+tasks|project\s+tasks|team\s+members|project\s+ke\s+tasks|project\s+members)(?:\s|$)/i.test(lower) ||
    (!mentionsProjectWord && /(?:members?|people|tasks?|टास्क|details?|info)/i.test(lower));

  const hasClientIndicator = /\b(?:clients?|cleints?|services?|सर्विस|plans?|subscription|esko|isko|iska|iski|inhe|unhe)\b/i.test(lower) || Boolean(draft?.lastClientId && draft?.lastActiveType === 'client');

  if (!hasClientIndicator && (hasPronoun || isGenericFollowup)) {
    const lastId = draft?.lastProjectId || draft?.projectId || draft?._lastProjectId || draft?._lastProject?._id;
    const lastName = draft?.lastProjectName || draft?.projectName || draft?._lastProjectName || draft?._lastProject?.name;
    if (lastId) {
      const found = projects.find(p => String(p._id || p.id) === String(lastId));
      if (found) return found;
    }
    if (lastName) {
      const found = projects.find(p => (p.projectName || p.name || '').toLowerCase() === String(lastName).toLowerCase());
      if (found) return found;
    }
  }

  // Search backwards in conversation history if pronoun like "es project" / "is project"
  const hist = Array.isArray(draft?.history) ? draft.history : (Array.isArray(draft?.messages) ? draft.messages : []);
  if (hist.length > 0 && /\b(?:is|es|iss|this|same|current)\b/i.test(lower)) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const hText = String(hist[i]?.content || hist[i]?.text || hist[i]?.message || '').toLowerCase();
      for (const p of projects) {
        const pName = (p.projectName || p.name || '').toLowerCase();
        if (pName && hText.includes(pName)) return p;
      }
    }
  }

  return null;
}

const CLIENT_STOPWORDS = new Set([
  'ko', 'ka', 'ki', 'ke', 'mein', 'mai', 'se', 'sai', 'kya', 'maine', 'main', 'hum', 'humne',
  'kisi', 'koi', 'sab', 'sabhi', 'mujhe', 'mera', 'meri', 'mere', 'apne', 'apna', 'apni',
  'kisko', 'kaun', 'kon', 'which', 'what', 'client', 'cleint', 'clint', 'ye', 'is', 'inhe', 'unhe',
  'aaj', 'kal', 'abhi', 'details', 'services', 'plans', 'status', 'diya', 'diye', 'di',
  'batao', 'dikhao', 'check', 'karo', 'hai', 'hain', 'tha', 'thi', 'the', 'kaise', 'kyu', 'kyun', 'kis',
  'and', 'or', 'ya', 'aur', 'with', 'the', 'a', 'an', 'kaunsi', 'konsi', 'kaunsa', 'konsa', 'active',
  'current', 'all', 'new', 'naya', 'nayi', 'naye'
]);

function extractDirectClientMention(message) {
  if (!message || typeof message !== 'string') return null;
  const directMatch = message.match(/(?:client|cleint)\s+([a-zA-Z\u0900-\u097F]+)/i);
  if (directMatch && directMatch[1] && !CLIENT_STOPWORDS.has(directMatch[1].toLowerCase())) {
    return directMatch[1].trim();
  }
  const prefixMatch = message.match(/\b([a-zA-Z\u0900-\u097F]+)\s+\b(?:client|cleint)\b/i);
  if (prefixMatch && prefixMatch[1] && !CLIENT_STOPWORDS.has(prefixMatch[1].toLowerCase())) {
    return prefixMatch[1].trim();
  }
  return null;
}

function getClientPlanName(client, clientPlans = []) {
  if (!client) return '';
  const ref = client.activeClientPlan || client.plan;
  if (!ref) return '';
  if (typeof ref === 'object') {
    if (ref.name) return String(ref.name);
    if (ref.title) return String(ref.title);
  }
  const idStr = String(ref._id || ref.id || ref);
  const found = clientPlans.find(p => String(p._id || p.id) === idStr || String(p.name || '').toLowerCase() === idStr.toLowerCase());
  if (found && found.name) return String(found.name);
  if (typeof ref === 'string' && ref.length < 50 && !/^[0-9a-fA-F]{24}$/.test(ref)) {
    return ref;
  }
  return '';
}

function getClientServices(client) {
  if (!client || !Array.isArray(client.services)) return [];
  return client.services.map(s => {
    if (typeof s === 'string') return s;
    return s.service || s.name || s.servicename || '';
  }).filter(Boolean);
}

function checkClientsByPlanOrService(message, clients = [], clientPlans = [], servicesPool = []) {
  if (!message || typeof message !== 'string') return null;

  // If user named a specific client (e.g. "client saniha", "kanika client"),
  // let single client handling resolve it instead of reverse plan search
  const directClient = extractDirectClientMention(message);
  if (directClient) {
    return null;
  }

  const cleanMsg = message.toLowerCase();

  // 1. Check if user is asking about plans
  let matchedPlanTerm = '';
  let matchedPlanDoc = null;
  for (const p of clientPlans) {
    const pName = (p.name || '').toLowerCase();
    if (pName && cleanMsg.includes(pName)) {
      matchedPlanTerm = p.name;
      matchedPlanDoc = p;
      break;
    }
    const words = pName.split(/\s+/).filter(w => w.length > 3 && !['plan', 'pack', 'tier'].includes(w));
    for (const w of words) {
      if (new RegExp('\\b' + escapeRegex(w) + '\\b', 'i').test(cleanMsg)) {
        matchedPlanTerm = w;
        matchedPlanDoc = p;
        break;
      }
    }
    if (matchedPlanTerm) break;
  }

  if (!matchedPlanTerm) {
    const planMatch = cleanMsg.match(/\b([a-zA-Z0-9_\-]+)\s+plan\b/i) || cleanMsg.match(/\bplan\s+([a-zA-Z0-9_\-]+)\b/i);
    if (planMatch && planMatch[1] && !CLIENT_STOPWORDS.has(planMatch[1].toLowerCase())) {
      matchedPlanTerm = planMatch[1];
    }
  }

  // 2. Check if user is asking about services
  let matchedServiceTerm = '';
  const allServices = Array.from(new Set([
    ...(Array.isArray(servicesPool) ? servicesPool : []),
    ...clients.flatMap(c => getClientServices(c)),
    'Cloud Architecture', 'Web Development', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design'
  ]));

  for (const s of allServices) {
    const sName = (typeof s === 'string' ? s : (s.name || s.service || '')).toLowerCase();
    if (sName && cleanMsg.includes(sName)) {
      matchedServiceTerm = typeof s === 'string' ? s : (s.name || s.service || '');
      break;
    }
  }

  if (!matchedPlanTerm && !matchedServiceTerm) {
    return null;
  }

  const isAskingWhichClients = /(?:kya\s+(?:maine\s+)?kisi\s+client|kin\s+clients?|kon\s+kon\s+(?:se|sai)\s+client|kaun\s+(?:se|kaun)\s+client|kis\s+client|which\s+clients?|who\s+has|any\s+client|clients?\s+(?:with|having|jinko|jinhe|ko)|diya\s+(?:hai|hain)|mila\s+(?:hai|hain))/i.test(cleanMsg);

  if (!isAskingWhichClients) {
    return null;
  }

  if (matchedPlanTerm) {
    const termLower = matchedPlanTerm.toLowerCase();
    const matchingClients = clients.filter(c => {
      const pName = getClientPlanName(c, clientPlans).toLowerCase();
      return pName && (pName.includes(termLower) || termLower.includes(pName));
    });
    return {
      type: 'plan',
      term: matchedPlanDoc ? matchedPlanDoc.name : (matchedPlanTerm.charAt(0).toUpperCase() + matchedPlanTerm.slice(1)),
      rawTerm: matchedPlanTerm,
      clients: matchingClients
    };
  }

  if (matchedServiceTerm) {
    const termLower = matchedServiceTerm.toLowerCase();
    const matchingClients = clients.filter(c => {
      const sList = getClientServices(c).map(s => s.toLowerCase());
      return sList.some(s => s.includes(termLower) || termLower.includes(s));
    });
    return {
      type: 'service',
      term: matchedServiceTerm,
      rawTerm: matchedServiceTerm,
      clients: matchingClients
    };
  }

  return null;
}

function isCrmTaskUpdate(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();

  // Strict creation guard: If message has explicit creation intent, it is NOT an update!
  const hasCreationIntent = (
    /\b(?:create|banao|bana\s*do|banayein|add|naya|nayi|naye|new)\s*(?:a\s+|an\s+|the\s+|my\s+|mera\s+|meri\s+|mere\s+|apna\s+|apne\s+)?(?:personal\s+|self\s+)?(?:task|project|client|plan)\b/i.test(clean) ||
    /\b(?:personal\s+task|self\s+task|mera\s+task|apna\s+task)\s*(?:create|banao|bana\s*do|banayein)\b/i.test(clean) ||
    /(?:मेरा|मेरी|मेरे|अपना|अपने)\s*(?:पर्सनल\s*)?टास्क\s*(?:क्रिएट|बनाओ|बना\s*दो|बनाएं|करो)/iu.test(clean) ||
    /(?:टास्क\s*का\s*नाम|task\s*ka\s*naam|task\s*name)\b/i.test(clean) ||
    /\b(?:create\s+task|create\s+project|create\s+client|create\s+plan)\b/i.test(clean) ||
    /\b(?:personal\s+task\s+create|task\s+create\s+karo)\b/i.test(clean)
  );
  if (hasCreationIntent) return false;

  return CRM_TASK_COMPLETE_REGEX.test(clean) || CRM_TASK_UPDATE_REGEX.test(clean) || CRM_TASK_EDIT_REGEX.test(clean);
}

function getIstDayRange(now = new Date()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const date = istNow.getUTCDate();

  const startUtc = new Date(Date.UTC(year, month, date, 0, 0, 0) - istOffsetMs);
  const endUtc = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - istOffsetMs);
  return { start: startUtc, end: endUtc, dateStr: `${year}-${month + 1}-${date}` };
}

function isActionOrCreationCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();

  // Explicit creation phrases must ALWAYS be treated as creation commands regardless of trailing or speech-recognition question marks
  const hasExplicitCreation = (
    /\b(?:create|banao|bana\s*do|banayein|add|naya|nayi|naye|new)\s*(?:a\s+|an\s+|the\s+|my\s+|mera\s+|meri\s+|mere\s+|apna\s+|apne\s+)?(?:personal\s+|self\s+|client\s+)?(?:task|project|client|plan)\b/i.test(clean) ||
    /\b(?:personal\s+task|self\s+task|client\s+task|mera\s+task|apna\s+task)\s*(?:create|banao|bana\s*do|banayein)\b/i.test(clean) ||
    /(?:मेरा|मेरी|मेरे|अपना|अपने)\s*(?:पर्सनल\s*)?टास्क\s*(?:क्रिएट|बनाओ|बना\s*दो|बनाएं|करो)/iu.test(clean) ||
    /(?:टास्क\s*का\s*नाम|task\s*ka\s*naam|task\s*name)\b/i.test(clean) ||
    /\b(?:create\s+task|create\s+project|create\s+client|create\s+plan|create\s+client\s+task)\b/i.test(clean) ||
    /\b(?:personal\s+task\s+create|task\s+create\s+karo|client\s+task\s+create)\b/i.test(clean)
  );
  if (hasExplicitCreation) return true;

  const isQuestionOrInquiry = /(?:^(?:kya|did|have|has|check)|(?:kitne|kitna|how\s+many|kaun|kon|konsi|kaunsi|kisko|kinhe|kin\s+|batao|dikhao|list|kiya\s+(?:hai|hain|tha|hoga)|bana\s+(?:hai|hain|tha)|create\s+hua))/i.test(clean);
  if (isQuestionOrInquiry && !/\b(?:create|banao|add|dalo|likho)\b/i.test(clean)) return false;

  return (
    /\b(?:banao|banayein|create|add|assign|kardo|karo|karu|karun|set|badlo|change|update|edit|cancel|delete|hatao|dalo|likho)\b/i.test(clean) ||
    /\b(?:task\s+ka\s+naam|task\s+name|task\s+assign|task\s+banao|naya\s+task|new\s+task|personal\s+task|parshan\s+task|project\s+banao|naya\s+project|new\s+project|client\s+banao|naya\s+client|new\s+client|client\s+add|client\s+task)\b/i.test(clean) ||
    /(?:टास्क|काम|प्रोजेक्ट|क्लाइंट|प्लान|बनाओ|बनाएं|बना|क्रिएट|क्रियेट|करो|करूं|करू|असाइन|नाम|शीर्षक|जोड़ो|ऐड)/iu.test(clean)
  );
}

function isCrmQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();

  // Explicit creation requests must NEVER be hijacked as CRM queries!
  const hasExplicitCreation = (
    /\b(?:create|banao|bana\s*do|banayein|add)\s*(?:a\s+|an\s+|the\s+|my\s+|mera\s+|meri\s+|mere\s+|apna\s+|apne\s+)?(?:personal\s+|self\s+|client\s+)?(?:task|project|client|plan)\b/i.test(clean) ||
    /\b(?:personal\s+task|self\s+task|client\s+task|mera\s+task|apna\s+task)\s*(?:create|banao|bana\s*do|banayein)\b/i.test(clean) ||
    /(?:मेरा|मेरी|मेरे|अपना|अपने)\s*(?:पर्सनल\s*)?टास्क\s*(?:क्रिएट|बनाओ|बना\s*दो|बनाएं|करो)/iu.test(clean) ||
    /(?:टास्क\s*का\s*नाम|task\s*ka\s*naam|task\s*name)\b/i.test(clean) ||
    /\b(?:create\s+task|create\s+project|create\s+client|create\s+plan|create\s+client\s+task)\b/i.test(clean) ||
    /\b(?:personal\s+task\s+create|task\s+create\s+karo|client\s+task\s+create)\b/i.test(clean)
  );
  if (hasExplicitCreation) return false;

  const isPastQuestionOrInquiry = /(?:^(?:kya|did|have|has|check\s+karo\s+kya)|(?:\?|kiya\s+(?:hai|hain|tha|hoga)|bana\s+(?:hai|hain|tha)|create\s+hua))/i.test(clean);
  const hasCreationCommand = !isPastQuestionOrInquiry && (
    isActionOrCreationCommand(clean) ||
    /\b(?:create|make|add|start|banao|bana\s*do|banayein|assign|set)\s*(?:a\s+|an\s+|the\s+|my\s+|one\s+|mera\s+|meri\s+|mere\s+|apna\s+|apne\s+)?(?:new\s+|naya\s+|naye\s+)?(?:personal\s+|self\s+)?(?:task|project|client|plan)\b/i.test(clean) ||
    /\b(?:task\s+naam|task\s+name|task\s+banao|naya\s+task|new\s+task|create\s+task|assign\s+karo|description\s+|priority\s+(?:high|medium|low|urgent)|project\s+banao|naya\s+project|new\s+project|create\s+project|client\s+add|client\s+banao|new\s+client|create\s+client)\b/i.test(clean)
  );
  if (hasCreationCommand) return false;
  if (isCrmTaskUpdate(clean)) return false;

  const isMemberOrDetailQuery = /(?:team\s*members?|members?|details?|info|tasks?|टास्क|लोग|मेंबर्स).*(?:kitne|kitna|kon|kaun|kaunsi|konsi|which|what|list|dikhao|batao|tell|show|hai|hain|check|\?)/iu.test(clean) ||
    /(?:kitne|kitna|how\s+many|kon|kaun|konsi|kaunsi|which|what|list|dikhao|batao|tell|show|check).*(?:team\s*members?|members?|details?|info|tasks?|टास्क|लोग|मेंबर्स)/iu.test(clean) ||
    /\b(?:check\s+project\s+details|project\s+details|view\s+project|view\s+tasks|project\s+tasks|team\s+members)\b/i.test(clean);

  return isMemberOrDetailQuery || CRM_PROJECTS_QUERY_REGEX.test(clean) || CRM_CLIENTS_QUERY_REGEX.test(clean) || CRM_TASKS_QUERY_REGEX.test(clean) || CLIENT_DETAIL_QUERY_REGEX.test(clean);
}

function formatProjectDetails(project, req, isEn = false) {
  const pName = project.projectName || project.name || 'Project';
  const pStatus = project.status ? (project.status.charAt(0).toUpperCase() + project.status.slice(1)) : 'Active';
  const pPriority = project.priority ? (project.priority.charAt(0).toUpperCase() + project.priority.slice(1)) : 'Medium';
  const pStart = project.startDate ? formatHumanIstDate(project.startDate) : 'Not set';
  const pEnd = (project.endDate || project.dueDate) ? formatHumanIstDate(project.endDate || project.dueDate) : 'Not set';
  const pDesc = project.description ? project.description.trim() : 'No description provided';

  const usersList = Array.isArray(project.users) ? project.users : [];
  const memberNames = usersList.map(u => typeof u === 'object' ? (u.name || u.userName || 'Member') : 'Member');
  const membersStr = memberNames.length > 0
    ? `${memberNames.length} Members (${memberNames.join(', ')})`
    : '0 Members';

  const pTasks = Array.isArray(project.tasks) ? project.tasks : [];
  const pendingTasks = pTasks.filter(t => ['pending', 'reopen'].includes(String(t.status || '').toLowerCase())).length;
  const inProgressTasks = pTasks.filter(t => ['in progress', 'in-progress'].includes(String(t.status || '').toLowerCase())).length;
  const onHoldTasks = pTasks.filter(t => ['on hold', 'on-hold', 'hold'].includes(String(t.status || '').toLowerCase())).length;
  const completedTasks = pTasks.filter(t => ['completed', 'approved'].includes(String(t.status || '').toLowerCase())).length;

  let taskBreakdown = `${pTasks.length} Tasks`;
  if (pTasks.length > 0) {
    const parts = [];
    if (pendingTasks > 0) parts.push(`${pendingTasks} Pending`);
    if (inProgressTasks > 0) parts.push(`${inProgressTasks} In Progress`);
    if (onHoldTasks > 0) parts.push(`${onHoldTasks} On Hold`);
    if (completedTasks > 0) parts.push(`${completedTasks} Completed`);
    if (parts.length > 0) taskBreakdown += ` (${parts.join(', ')})`;
  }

  return isEn
    ? `📁 **Project: ${pName}**\n\n• **Status**: ${pStatus}\n• **Priority**: ${pPriority}\n• **Members**: ${membersStr}\n• **Total Tasks**: ${taskBreakdown}\n• **Start Date**: ${pStart}\n• **Due Date**: ${pEnd}\n• **Description**: ${pDesc}\n\nWould you like to view project tasks, see team members, or add a new task?`
    : `📁 **Project: ${pName}**\n\n• **Status**: ${pStatus}\n• **Priority**: ${pPriority}\n• **Members**: ${membersStr}\n• **Total Tasks**: ${taskBreakdown}\n• **Start Date**: ${pStart} • **Due Date**: ${pEnd}\n• **Description**: ${pDesc}\n\nKya aap is project ke tasks dekhna chahte hain ya team members check karna chahte hain?`;
}

function formatProjectTeamMembers(project, req, isEn = false) {
  const pName = project.projectName || project.name || 'Project';
  const usersList = Array.isArray(project.users) ? project.users : [];
  if (usersList.length === 0) {
    return isEn
      ? `Project **${pName}** currently has no team members assigned.`
      : `Project **${pName}** mein abhi koi team member add nahi hai.`;
  }

  const list = usersList.map((u, idx) => {
    const name = typeof u === 'object' ? (u.name || u.userName || 'Member') : 'Member';
    const role = typeof u === 'object' && (u.jobRole?.name || u.role || u.companyRole) ? ` — *${u.jobRole?.name || u.role || u.companyRole}*` : '';
    const email = typeof u === 'object' && u.email ? ` (\`${u.email}\`)` : '';
    return `${idx + 1}. **${name}**${role}${email}`;
  }).join('\n');

  return isEn
    ? `👥 Project **${pName}** has **${usersList.length} team member(s)**:\n\n${list}\n\nWould you like to view project tasks or add a new task?`
    : `👥 Project **${pName}** mein total **${usersList.length} team member(s)** add hain:\n\n${list}\n\nKya aap is project ke tasks dekhna chahte hain ya naya task add karna chahte hain?`;
}

function formatProjectTasksList(project, req, isEn = false) {
  const pName = project.projectName || project.name || 'Project';
  const pTasks = Array.isArray(project.tasks) ? project.tasks : [];
  if (pTasks.length === 0) {
    return isEn
      ? `Project **${pName}** currently has **0 tasks**.\n\nWould you like to create a new task in this project?`
      : `Project **${pName}** mein abhi koi task create nahi kiya gaya hai (Total 0 tasks).\n\nKya aap is project mein naya task banana chahte hain?`;
  }

  const taskCards = pTasks.map((t, idx) => {
    const title = t.title || t.name || 'Untitled Task';
    const status = t.status ? (t.status.charAt(0).toUpperCase() + t.status.slice(1)) : 'Pending';
    const priority = t.priority ? (t.priority.charAt(0).toUpperCase() + t.priority.slice(1)) : 'Medium';
    
    // Extract assignees
    let assigneesStr = 'Unassigned';
    const assignedUsers = Array.isArray(t.assignedUsers) ? t.assignedUsers : (t.assignedTo ? [t.assignedTo] : []);
    if (assignedUsers.length > 0) {
      const names = assignedUsers.map(u => typeof u === 'object' ? (u.name || u.userName || 'User') : 'User');
      assigneesStr = names.join(', ');
    }
    const due = (t.dueDateTime || t.dueDate) ? formatHumanIstDate(t.dueDateTime || t.dueDate) : null;
    const desc = t.description ? t.description.trim() : null;

    let lines = [
      `${idx + 1}. **${title}**`,
      `   • **Status**: ${status} | **Priority**: ${priority}`,
      `   • **Assignees**: ${assigneesStr}`
    ];
    if (due) lines.push(`   • **Due Date**: ${due}`);
    if (desc) lines.push(`   • **Description**: ${desc}`);
    return lines.join('\n');
  }).join('\n\n');

  return isEn
    ? `📋 Project **${pName}** tasks (Showing ${pTasks.length} of ${pTasks.length} tasks):\n\n${taskCards}\n\nYou can update the status of any task (e.g., *"Change status of ${pTasks[0]?.title || 'task'} to completed"*) or edit its details.`
    : `📋 Project **${pName}** ke tasks (Total ${pTasks.length} tasks):\n\n${taskCards}\n\nAap kisi bhi task ka status update kar sakte hain (jaise: *"Task '${pTasks[0]?.title || 'task'}' ka status completed kardo"*) ya details edit kar sakte hain.`;
}

async function handleCrmQuery(message, req, deps = {}, lang = 'hinglish', context = {}) {
  const isEn = lang === 'en';
  const userId = req?.user?._id || req?.user?.id;
  const rawName = String(req?.user?.name || req?.user?.userName || '').trim();
  const firstName = rawName ? rawName.split(/\s+/)[0] : '';
  const capitalized = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : '';

  let greetingPrefix = '';
  if (/\b(?:good|gud)\s*morning\b/i.test(message)) {
    greetingPrefix = isEn ? `Good morning${capitalized ? ' ' + capitalized : ''}! ` : `Good morning${capitalized ? ' ' + capitalized : ''}! `;
  } else if (/\b(?:good|gud)\s*afternoon\b/i.test(message)) {
    greetingPrefix = isEn ? `Good afternoon${capitalized ? ' ' + capitalized : ''}! ` : `Good afternoon${capitalized ? ' ' + capitalized : ''}! `;
  } else if (/\b(?:good|gud)\s*evening\b/i.test(message)) {
    greetingPrefix = isEn ? `Good evening${capitalized ? ' ' + capitalized : ''}! ` : `Good evening${capitalized ? ' ' + capitalized : ''}! `;
  } else if (/\b(?:hi|hello|hey|namaste)\b/i.test(message)) {
    greetingPrefix = isEn ? `Hello${capitalized ? ' ' + capitalized : ''}! ` : `Namaste${capitalized ? ' ' + capitalized : ''}! `;
  }

  const rawCompanyCode = req?.user?.companyCode || req?.user?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  const clients = context.accessibleClients || deps.accessibleClients || deps.clients || context.clients || [];
  const projects = context.accessibleProjects || deps.accessibleProjects || deps.projects || context.projects || [];
  const draft = context.draft || deps.draft || {};
  const queryDeps = { ...deps, accessibleProjects: projects };
  const allowedIntents = resolveUserAllowedIntents(req?.user, context.scope, queryDeps);

  const mentionsProject = /(?:projects?|projekts?|projets?|प्रोजेक्ट्स?|प्रजेक्ट|प्रोज़ेक्ट)/iu.test(message);
  const matchedProject = findReferencedProject(message, projects, draft);

  // Inaccessible project RBAC guard:
  if (mentionsProject && !matchedProject) {
    const isDbReady = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
    const ProjectModel = deps.Project || DefaultProjectModel || (mongoose?.models?.Project) || (isDbReady ? require('../../HR-CDS/models/Project').Project : null);
    if (isDbReady && ProjectModel && typeof ProjectModel.findOne === 'function') {
      try {
        const cleanNamePart = message.replace(/^(?:kya|show|view|check|dikhao|batao|details|project|tasks|members)\s+/i, '').trim();
        if (cleanNamePart.length >= 3) {
          const anyProject = await ProjectModel.findOne({
            isActive: { $ne: false },
            projectName: { $regex: new RegExp(escapeRegex(cleanNamePart), 'i') }
          }).lean();
          if (anyProject && !hasProjectAccess(anyProject, userId, req?.user?.role, req?.user)) {
            const pName = anyProject.projectName || 'Project';
            const denial = isEn
              ? `You do not have access to the "${pName}" project in your account.`
              : `Aapke account mein "${pName}" project ka access nahi hai, isliye main iski details nahi dikha sakta.`;
            return {
              success: true,
              status: 'open',
              field: 'welcome',
              reply: denial,
              speech: denial,
              speakText: denial,
              draft: null,
              chips: [{ label: 'Main menu', action: { type: 'reset' } }],
              candidates: [],
              notices: []
            };
          }
        }
      } catch {}
    }

    const candidateProjName = extractCandidateProjectName(message);
    if (candidateProjName && !matchedProject) {
      const availLines = projects.slice(0, 5).map((p, idx) => `${idx + 1}. **${p.projectName || p.name}**`).join('\n');
      const rep = isEn
        ? `Could not find a project named "${candidateProjName}" in your account.\n\nYour accessible project(s):\n${availLines || 'No accessible projects'}\n\nPlease choose a project or check the project name.`
        : `Aapke account mein "${candidateProjName}" naam ka koi project nahi mila.\n\nAapke accessible projects ye hain:\n\n${availLines || 'Koi accessible project nahi hai'}\n\nKripya inme se kisi project ka naam batayein.`;

      const projChips = projects.slice(0, 4).map(p => ({
        label: `${p.projectName || p.name} details`,
        action: { type: 'view_project', projectId: String(p._id || p.id) }
      }));
      projChips.push({ label: 'Main menu', action: { type: 'reset' } });

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: isEn ? `Project ${candidateProjName} not found.` : `${candidateProjName} naam ka project nahi mila.`,
        speakText: rep,
        speakTextHi: isEn ? null : `${candidateProjName} naam ka project nahi mila.`,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: projChips,
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
  }

  const clientPlansPool = deps.clientPlans || [];
  const servicesPool = deps.services || [];
  const planOrServiceFilter = !mentionsProject ? checkClientsByPlanOrService(message, clients, clientPlansPool, servicesPool) : null;
  const matchedClientRef = findReferencedClient(message, clients, draft);
  const isCreationOrMutation = /(?:create|add|assign|banao|banayein|kardo|karo|set|badlo|change|update|delete|hatao)\b/i.test(message);

  const isAskingMembersSpecifically = /(?:members?|people|log|members\s+add|members\s+hain|kon\s+kon|kaun\s+kaun|kitne\s+members|team\s+members?|टीम\s*मेंबर्स?)/i.test(message);
  const isAskingTasksSpecifically = /(?:tasks?|टास्क).*?(?:kitne|kitna|how\s+many|batao|dikhao|status|list|details?|hai|hain|show|view)|(?:kitne|kitna|how\s+many|kaun\s+se|view|show|check).*?(?:tasks?|टास्क)/i.test(message);
  const isProjectInquiry = Boolean(matchedProject) && !matchedClientRef && (
    mentionsProject ||
    /(?:details?|status|members?|tasks?|टास्क|log|info|kya|kon|kaun|kab|deadline|batao|dikhao|view|check|\?)/iu.test(message) ||
    Boolean(draft?.lastProjectId && draft?.lastActiveType === 'project')
  );

  // 0. SPECIFIC PROJECT QUERY (Status, Members, Tasks, Details)
  if (isProjectInquiry && matchedProject) {
    const pName = matchedProject.projectName || matchedProject.name || 'Project';
    const pTasks = Array.isArray(matchedProject.tasks) ? matchedProject.tasks : [];

    let rep = '';
    let projChips = [];
    if (isAskingTasksSpecifically && !isAskingMembersSpecifically) {
      rep = formatProjectTasksList(matchedProject, req, isEn);
      if (pTasks[0]) {
        projChips.push({ label: `${pTasks[0].title || 'Task'} status update`, action: { type: 'update_project_task_status', projectId: String(matchedProject._id || matchedProject.id), taskId: String(pTasks[0]._id || pTasks[0].id), taskTitle: pTasks[0].title || 'Task' } });
      }
      projChips.push(
        { label: '+ Task add karein', action: { type: 'pickProject', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Project details', action: { type: 'view_project', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Team members list', action: { type: 'view_project_members', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Main menu', action: { type: 'reset' } }
      );
    } else if (isAskingMembersSpecifically) {
      rep = formatProjectTeamMembers(matchedProject, req, isEn);
      projChips.push(
        { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Project details', action: { type: 'view_project', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: `${pName} mein task banana`, action: { type: 'pickProject', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Main menu', action: { type: 'reset' } }
      );
    } else {
      rep = formatProjectDetails(matchedProject, req, isEn);
      projChips.push(
        { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Team members list', action: { type: 'view_project_members', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: `${pName} mein task banana`, action: { type: 'pickProject', projectId: String(matchedProject._id || matchedProject.id) } },
        { label: 'Main menu', action: { type: 'reset' } }
      );
    }

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: rep,
      speech: isEn ? `Project ${pName} details.` : `Project ${pName} ki details.`,
      speakText: rep,
      speakTextHi: isEn ? null : `Project ${pName} ki details.`,
      language: isEn ? 'en' : 'hinglish',
      draft: {
        lastActiveType: 'project',
        lastProjectId: String(matchedProject._id || matchedProject.id),
        lastProjectName: pName,
        lastClientId: null,
        lastClientName: null
      },
      chips: projChips,
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  // 0b. SPECIFIC CLIENT QUERY (Services, Plan, Status, Details)
  const isClientInquiry = !mentionsProject && (
    Boolean(planOrServiceFilter) ||
    Boolean(matchedClientRef) ||
    CLIENT_DETAIL_QUERY_REGEX.test(message) ||
    /(?:(?:client|cleint|clint|clinet|ग्राहक|कंपनी).*(?:details?|services?|plans?|tasks?|टास्क|kaam|काम|status|info|batao|dikhao|kya|kon|kaun|kin|kis|which|कौन|क्या|बताओ|दिखाओ))/iu.test(message) ||
    Boolean(draft?.lastClientId && /(?:services?|सर्विस|plans?|प्लान|tasks?|टास्क|details?|info)/i.test(message))
  );

  if (isClientInquiry) {
    if (!allowedIntents.includes('create_client') && !allowedIntents.includes('create_client_task')) {
      const denial = getPermissionDeniedReply('create_client', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
    if (planOrServiceFilter) {
      const isPlan = planOrServiceFilter.type === 'plan';
      const termName = planOrServiceFilter.term;
      const matched = planOrServiceFilter.clients;

      if (matched.length > 0) {
        const clientItems = matched.map((c, idx) => {
          const comp = c.company ? ` (*${c.company}*)` : '';
          const detail = isPlan
            ? `Plan: **${getClientPlanName(c, clientPlansPool) || termName}**`
            : `Services: **${getClientServices(c).join(', ') || termName}**`;
          return `${idx + 1}. **${c.client || c.name}**${comp} — ${detail}`;
        }).join('\n');

        const rep = isEn
          ? `${greetingPrefix}Yes! In your CRM, the **${termName}** ${isPlan ? 'plan' : 'service'} is assigned to the following client(s):\n\n${clientItems}\n\nWould you like to view details or assign a task for one of these clients?`
          : `${greetingPrefix}Haan! Aapke CRM mein **${termName}** ${isPlan ? 'plan' : 'service'} in client(s) ko assign kiya gaya hai:\n\n${clientItems}\n\nKya aap inme se kisi client ki details dekhna chahte hain ya task banana chahte hain?`;

        const filterChips = matched.slice(0, 4).map(c => ({
          label: `${c.client || c.name} ki details`,
          action: { type: 'set_intent', intent: 'create_client_task', client: c.client || c.name, clientId: String(c._id || c.id || '') }
        }));
        filterChips.push({ label: 'Client plan banana', action: { type: 'set_intent', intent: 'create_client_plan' } });
        filterChips.push({ label: 'Main menu', action: { type: 'reset' } });

        const spokenNames = matched.map(c => c.client || c.name).join(', ');
        const speech = isEn
          ? `The ${termName} ${isPlan ? 'plan' : 'service'} is assigned to ${spokenNames}.`
          : `Haan, ${termName} ${isPlan ? 'plan' : 'service'} ${spokenNames} ko diya hua hai.`;

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech,
          speakText: rep,
          speakTextHi: isEn ? null : speech,
          language: isEn ? 'en' : 'hinglish',
          draft: null,
          chips: filterChips,
          candidates: [],
          notices: [],
          canAssignOthers: context.canAssignOthers
        };
      } else {
        // No client found with this plan or service
        const clientLines = clients.map((c, idx) => {
          const comp = c.company ? ` (*${c.company}*)` : '';
          const currentPlan = getClientPlanName(c, clientPlansPool);
          return `${idx + 1}. **${c.client || c.name}**${comp} — Plan: ${currentPlan || (isEn ? 'No active plan' : 'Koi plan nahi')}`;
        }).join('\n');

        const rep = isEn
          ? `${greetingPrefix}No client in your CRM currently has the **${termName}** ${isPlan ? 'plan' : 'service'} assigned.\n\nRegistered clients and their current plans:\n\n${clientLines || 'No clients registered.'}\n\nWould you like to assign a plan to one of these clients?`
          : `${greetingPrefix}Aapke CRM mein kisi bhi client ko abhi **${termName}** ${isPlan ? 'plan' : 'service'} assign nahi kiya gaya hai.\n\nAapke registered clients aur unke current plans ye hain:\n\n${clientLines || 'Koi clients registered nahi hain.'}\n\nKya aap kisi client ko ye plan assign karna chahte hain?`;

        const filterChips = [
          { label: 'Client plan banana', action: { type: 'set_intent', intent: 'create_client_plan' } },
          { label: 'Main menu', action: { type: 'reset' } }
        ];

        const speech = isEn
          ? `No client currently has the ${termName} ${isPlan ? 'plan' : 'service'} assigned.`
          : `Aapke CRM mein kisi bhi client ko abhi ${termName} assign nahi kiya gaya hai.`;

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech,
          speakText: rep,
          speakTextHi: isEn ? null : speech,
          language: isEn ? 'en' : 'hinglish',
          draft: null,
          chips: filterChips,
          candidates: [],
          notices: [],
          canAssignOthers: context.canAssignOthers
        };
      }
    }

    const matchedClient = matchedClientRef || findReferencedClient(message, clients);
    if (matchedClient) {
      const clientDisplayName = matchedClient.client || matchedClient.name || 'Client';
      const compStr = matchedClient.company ? ` (*${matchedClient.company}*)` : '';
      const statusStr = matchedClient.status || 'Active';

      const isAskingAboutTasks = /(?:tasks?|टास्क|kaam|काम|subtasks?|work)/i.test(message);

      let servicesStr = '';
      const clientServicesList = Array.isArray(matchedClient.services) ? matchedClient.services : [];
      if (clientServicesList.length > 0) {
        const list = clientServicesList.map(s => typeof s === 'string' ? s : (s.service || s.name || s.servicename)).filter(Boolean);
        if (list.length > 0) servicesStr = list.join(', ');
      }
      if (!servicesStr) {
        servicesStr = isEn ? 'No services currently assigned' : 'Abhi koi service assign nahi hai';
      }

      // Check if user specifically asked about a specific service (e.g. "meesho", "amazon", "seo", "app development")
      let matchedServiceName = null;
      for (const s of clientServicesList) {
        const sName = typeof s === 'string' ? s : (s.service || s.name || s.servicename || '');
        if (!sName) continue;
        const sEscaped = escapeRegex(sName.trim());
        if (new RegExp(`(?:^|[^a-zA-Z0-9])${sEscaped}(?:[^a-zA-Z0-9]|$)`, 'i').test(message)) {
          matchedServiceName = sName;
          break;
        }
        const sWords = sName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !['account', 'listing', 'and', 'management', 'production', 'services'].includes(w));
        if (sWords.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(message))) {
          matchedServiceName = sName;
          break;
        }
      }

      // Query client tasks for this client
      const CTModel = deps.ClientTask || mongoose.models.ClientTask || ClientTask;
      let clientTasks = [];
      if (Array.isArray(deps.clientTasks)) {
        clientTasks = deps.clientTasks.filter(t => String(t.clientId) === String(matchedClient._id || matchedClient.id));
      } else if (CTModel && typeof CTModel.find === 'function') {
        try {
          const tQuery = { clientId: matchedClient._id || matchedClient.id };
          clientTasks = await CTModel.find(tQuery)
            .select('name service status assignee dueDate priority')
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();
        } catch (err) {
          console.warn('[taskAgentService] Error loading client tasks for query:', err);
        }
      }

      // SCENARIO 1: Specific Service Tasks Query (e.g. "Sarla Rani ki Meesho service ke tasks batao")
      if (matchedServiceName) {
        const serviceTasks = clientTasks.filter(t => {
          const ts = String(t.service || '').toLowerCase().trim();
          const ms = matchedServiceName.toLowerCase().trim();
          return ts.includes(ms) || ms.includes(ts);
        });

        let rep = '';
        if (serviceTasks.length > 0) {
          const taskLines = serviceTasks.slice(0, 15).map((t, i) => {
            const tName = t.name || t.title || 'Task';
            const tStatus = t.status ? `*${t.status}*` : '*pending*';
            const tAssignee = t.assignee ? ` (Assignee: **${t.assignee}**)` : '';
            const tDue = t.dueDate ? ` — Due: ${formatHumanIstDate(t.dueDate)}` : '';
            return `${i + 1}. **${tName}** — ${tStatus}${tAssignee}${tDue}`;
          }).join('\n');

          rep = isEn
            ? `${greetingPrefix}Client **${clientDisplayName}**${compStr} has **${serviceTasks.length} task(s)** under the **${matchedServiceName}** service:\n\n${taskLines}\n\nWould you like to assign a new task to this service?`
            : `${greetingPrefix}Client **${clientDisplayName}**${compStr} ki **${matchedServiceName}** service ke andar total **${serviceTasks.length} task(s)** hain:\n\n${taskLines}\n\nKya aap is service mein naya task banana chahte hain?`;
        } else {
          rep = isEn
            ? `${greetingPrefix}Client **${clientDisplayName}**${compStr} has the **${matchedServiceName}** service active, but there are currently **no tasks** created under this service.\n\nWould you like to create a task for this service?`
            : `${greetingPrefix}Client **${clientDisplayName}**${compStr} ke paas **${matchedServiceName}** service active hai, lekin is service ke andar abhi **koi task add nahi hai**.\n\nKya aap is service ke liye naya task banana chahte hain?`;
        }

        const taskChips = [
          { label: `${matchedServiceName} mein task banana`, action: { type: 'set_intent', intent: 'create_client_task', client: clientDisplayName, clientId: String(matchedClient._id || matchedClient.id || ''), service: matchedServiceName } },
          { label: 'Client plan banana', action: { type: 'set_intent', intent: 'create_client_plan' } },
          { label: 'Main menu', action: { type: 'reset' } }
        ];

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: isEn ? `Client ${clientDisplayName} ${matchedServiceName} service tasks.` : `Client ${clientDisplayName} ki ${matchedServiceName} service ke tasks.`,
          speakText: rep,
          speakTextHi: isEn ? null : `Client ${clientDisplayName} ki ${matchedServiceName} service ke tasks.`,
          language: isEn ? 'en' : 'hinglish',
          draft: {
            lastActiveType: 'client',
            lastClientId: String(matchedClient._id || matchedClient.id || ''),
            lastClientName: clientDisplayName,
            lastService: matchedServiceName,
            lastProjectId: null,
            lastProjectName: null
          },
          chips: taskChips,
          candidates: [],
          notices: [],
          canAssignOthers: context.canAssignOthers
        };
      }

      // SCENARIO 2: All Tasks Across Services Query (e.g. "Sarla Rani client ki services ke tasks dikhao")
      if (isAskingAboutTasks) {
        let rep = '';
        if (clientTasks.length > 0) {
          const tasksByService = new Map();
          for (const t of clientTasks) {
            const sKey = (t.service || 'General Service').trim();
            if (!tasksByService.has(sKey)) tasksByService.set(sKey, []);
            tasksByService.get(sKey).push(t);
          }

          const serviceSections = [];
          let sIdx = 1;
          for (const [sName, tList] of tasksByService.entries()) {
            const tItems = tList.slice(0, 5).map((t, i) => {
              const tName = t.name || t.title || 'Task';
              const tStatus = t.status ? `*${t.status}*` : '*pending*';
              const tAssignee = t.assignee ? ` (Assignee: **${t.assignee}**)` : '';
              return `   ${i + 1}. **${tName}** — ${tStatus}${tAssignee}`;
            }).join('\n');
            const extra = tList.length > 5 ? `\n   *...aur ${tList.length - 5} aur tasks*` : '';
            serviceSections.push(`• **Service ${sIdx++}: ${sName}** (${tList.length} task${tList.length > 1 ? 's' : ''}):\n${tItems}${extra}`);
          }

          rep = isEn
            ? `${greetingPrefix}Here are the tasks across services for client **${clientDisplayName}**${compStr} (Total: **${clientTasks.length} task(s)**):\n\n${serviceSections.join('\n\n')}\n\nWould you like to assign a new task to one of these services?`
            : `${greetingPrefix}Client **${clientDisplayName}**${compStr} ki services ke andar total **${clientTasks.length} task(s)** hain:\n\n${serviceSections.join('\n\n')}\n\nKya aap inme se kisi service ke liye naya task banana chahte hain?`;
        } else {
          rep = isEn
            ? `${greetingPrefix}Client **${clientDisplayName}**${compStr} has **${clientServicesList.length} service(s)** active (${servicesStr}), but there are currently **no tasks** created under any service.\n\nWould you like to create a client task now?`
            : `${greetingPrefix}Client **${clientDisplayName}**${compStr} ke paas **${clientServicesList.length} service(s)** active hain (${servicesStr}), lekin abhi inme se kisi bhi service mein **koi task add nahi hai**.\n\nKya aap is client ke liye task banana chahte hain?`;
        }

        const taskChips = [
          { label: `${clientDisplayName} ke liye task banana`, action: { type: 'set_intent', intent: 'create_client_task', client: clientDisplayName, clientId: String(matchedClient._id || matchedClient.id || '') } },
          { label: 'Client plan banana', action: { type: 'set_intent', intent: 'create_client_plan' } },
          { label: 'Main menu', action: { type: 'reset' } }
        ];

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: isEn ? `Client ${clientDisplayName} tasks across services.` : `Client ${clientDisplayName} ki services ke tasks.`,
          speakText: rep,
          speakTextHi: isEn ? null : `Client ${clientDisplayName} ki services ke tasks.`,
          language: isEn ? 'en' : 'hinglish',
          draft: {
            lastActiveType: 'client',
            lastClientId: String(matchedClient._id || matchedClient.id || ''),
            lastClientName: clientDisplayName,
            lastService: matchedServiceName,
            lastProjectId: null,
            lastProjectName: null
          },
          chips: taskChips,
          candidates: [],
          notices: [],
          canAssignOthers: context.canAssignOthers
        };
      }

      // SCENARIO 3: General Client Details Query (Services, Plan, Status, Tasks count)
      let planStr = '';
      const activePlanRef = matchedClient.activeClientPlan;
      if (activePlanRef) {
        if (typeof activePlanRef === 'object' && activePlanRef.name) {
          const priceStr = activePlanRef.price != null ? ` (₹${Number(activePlanRef.price).toLocaleString('en-IN')})` : '';
          planStr = `${activePlanRef.name}${priceStr}`;
        } else {
          const plansPool = deps.clientPlans || [];
          const pDoc = plansPool.find(p => String(p._id || p.id) === String(activePlanRef));
          if (pDoc) {
            const priceStr = pDoc.price != null ? ` (₹${Number(pDoc.price).toLocaleString('en-IN')})` : '';
            planStr = `${pDoc.name}${priceStr}`;
          }
        }
      }
      if (!planStr) {
        planStr = isEn ? 'No active plan assigned' : 'Abhi koi plan assign nahi hai';
      }

      let pmStr = '';
      if (Array.isArray(matchedClient.projectManager) && matchedClient.projectManager.length > 0) {
        pmStr = matchedClient.projectManager.join(', ');
      }

      const taskSummaryLine = clientTasks.length > 0
        ? `\n• **Client Tasks**: ${clientTasks.length} task(s) across active services`
        : '\n• **Client Tasks**: 0 tasks created';

      const rep = isEn
        ? `${greetingPrefix}Here are the CRM details for client **${clientDisplayName}**${compStr}:\n\n• **Services**: ${servicesStr}\n• **Active Plan**: ${planStr}\n• **Status**: ${statusStr}${pmStr ? `\n• **Project Manager**: ${pmStr}` : ''}${taskSummaryLine}\n\nWould you like to view service tasks or assign a new task for this client?`
        : `${greetingPrefix}Client **${clientDisplayName}**${compStr} ki CRM details:\n\n• **Services**: ${servicesStr}\n• **Active Plan**: ${planStr}\n• **Status**: ${statusStr}${pmStr ? `\n• **Project Manager**: ${pmStr}` : ''}${taskSummaryLine}\n\nKya aap is client ki services ke tasks dekhna chahte hain ya naya task banana chahte hain?`;

      const clientChips = [
        ...(clientTasks.length > 0 ? [{ label: 'Services ke tasks dekhna', action: { type: 'set_intent', intent: 'create_client_task', client: clientDisplayName, clientId: String(matchedClient._id || matchedClient.id || '') } }] : []),
        { label: `${clientDisplayName} ke liye task banana`, action: { type: 'set_intent', intent: 'create_client_task', client: clientDisplayName, clientId: String(matchedClient._id || matchedClient.id || '') } },
        { label: 'Client plan banana', action: { type: 'set_intent', intent: 'create_client_plan' } },
        { label: 'Main menu', action: { type: 'reset' } }
      ];

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: isEn ? `Client ${clientDisplayName}: services, plan and task details.` : `Client ${clientDisplayName} ki services, plan aur task details.`,
        speakText: rep,
        speakTextHi: isEn ? null : `Client ${clientDisplayName} ki services, plan aur task details.`,
        language: isEn ? 'en' : 'hinglish',
        draft: {
          lastActiveType: 'client',
          lastClientId: String(matchedClient._id || matchedClient.id || ''),
          lastClientName: clientDisplayName,
          lastProjectId: null,
          lastProjectName: null
        },
        chips: clientChips,
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    } else {
      // Inquired about a client, but name not found in pool
      let targetName = '';
      const directMatch = message.match(/(?:client|cleint)\s+([a-zA-Z\u0900-\u097F]+)/i);
      if (directMatch && directMatch[1] && !CLIENT_STOPWORDS.has(directMatch[1].toLowerCase())) {
        targetName = directMatch[1].trim();
      } else {
        const nameMatch = message.match(/\b([a-zA-Z\u0900-\u097F]+)\s+\b(?:client|cleint|ko|ka|ki|को|का|की)\b/i);
        if (nameMatch && nameMatch[1]) {
          const candidate = nameMatch[1].trim();
          if (!CLIENT_STOPWORDS.has(candidate.toLowerCase())) {
            targetName = candidate;
          }
        }
      }

      const clientLines = clients.slice(0, 10).map((c, idx) => {
        const sList = Array.isArray(c.services) ? c.services.slice(0, 3).join(', ') : '';
        const sExtra = Array.isArray(c.services) && c.services.length > 3 ? ` (+${c.services.length - 3} more)` : '';
        return `${idx + 1}. **${c.client || c.name}**${c.company ? ` (${c.company})` : ''}${sList ? ` — Services: *${sList}${sExtra}*` : ''}`;
      }).join('\n');
      const rep = targetName
        ? (isEn
            ? `${greetingPrefix}No client named **"${targetName}"** was found in your CRM.\n\nRegistered clients in your CRM:\n\n${clientLines || 'No clients registered.'}\n\nWould you like to check services or tasks for one of these clients?`
            : `${greetingPrefix}CRM mein **"${targetName}"** naam ka koi client nahi mila.\n\nAapke CRM mein registered clients ye hain:\n\n${clientLines || 'Koi clients registered nahi hain.'}\n\nAap inme se kisi client ki services ya tasks check karna chahte hain?`)
        : (isEn
            ? `${greetingPrefix}Which client's service tasks would you like to check? You can ask, for example: **"Show tasks for [Client Name] in [Service Name]"**.\n\nRegistered clients and active services:\n\n${clientLines}`
            : `${greetingPrefix}Aap kis client ki service ke tasks check karna chahte hain? Aap bol ya likh sakte hain, jaise: **"[Client Name] ki [Service Name] service ke tasks dikhao"**.\n\nAapke registered clients aur services ye hain:\n\n${clientLines}`);

      const clientChips = clients.slice(0, 5).map(c => ({
        label: `${c.client || c.name} ke tasks`,
        action: { type: 'set_intent', intent: 'create_client_task', client: c.client || c.name, clientId: String(c._id || c.id || '') }
      }));
      clientChips.push({ label: 'Main menu', action: { type: 'reset' } });

      const notFoundSpeech = targetName
        ? (isEn ? `No client named ${targetName} was found in your CRM.` : `CRM mein ${targetName} naam ka koi client nahi mila.`)
        : (isEn ? 'Which client details would you like to check?' : 'Kaun se client ki details check karni hain?');

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: notFoundSpeech,
        speakText: rep,
        speakTextHi: isEn ? null : notFoundSpeech,
        language: isEn ? 'en' : 'hinglish',
        draft: {
          lastActiveType: 'client',
          lastClientId: String(matchedClient._id || matchedClient.id || ''),
          lastClientName: clientDisplayName,
          lastProjectId: null,
          lastProjectName: null
        },
        chips: clientChips,
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
  }

  // 1. Projects Query (Check projects before general task queries)
  // Ensure task queries (e.g. "es project mai total kitne task hain") are not intercepted as "list all projects"
  if (CRM_PROJECTS_QUERY_REGEX.test(message) && !/\b(?:tasks?|टास्क)\b/i.test(message)) {
    if (!allowedIntents.includes('create_project') && !allowedIntents.includes('task_project')) {
      const denial = getPermissionDeniedReply('create_project', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
    const rawProjects = context.accessibleProjects || deps.accessibleProjects || [];
    const uniqueProjMap = new Map();
    for (const p of rawProjects) {
      const pName = (p.projectName || p.name || 'Untitled').trim();
      const existing = uniqueProjMap.get(pName.toLowerCase());
      if (!existing) {
        uniqueProjMap.set(pName.toLowerCase(), p);
      } else if (Array.isArray(p.tasks) && p.tasks.length > (existing.tasks?.length || 0)) {
        uniqueProjMap.set(pName.toLowerCase(), p);
      }
    }
    const projects = Array.from(uniqueProjMap.values());

    // Check if user specifically asked if they created a new/recent project (e.g. "kya maine abhi koi new project create kiya hai?")
    const isAskingIfCreated = /(?:kya\s+(?:maine|koi)|did\s+i|have\s+i).*?(?:new|naya|abhi|recent).*?(?:project|cretae|create|bana)/i.test(message) ||
                              /(?:cretae|create|bana).*?(?:kiya\s+(?:hai|hain|tha)|hua)/i.test(message);

    if (isAskingIfCreated) {
      if (projects.length === 0) {
        const rep = isEn
          ? `${greetingPrefix}No, you haven't created any new project yet. Would you like to create one now?`
          : `${greetingPrefix}Nahi, abhi aapne koi naya project create nahi kiya hai. Kya aap naya project banana chahte hain?`;
        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: rep,
          speakText: rep,
          speakTextHi: rep,
          draft: null,
          chips: [
            { label: 'Naya project banana', action: { type: 'set_intent', intent: 'create_project' } },
            { label: 'Main menu', action: { type: 'reset' } },
          ],
          candidates: [],
          notices: [],
          canAssignOthers: context.canAssignOthers
        };
      }

      const projLines = projects.map((p, idx) => {
        const name = p.projectName || p.name || 'Untitled';
        const status = p.status ? ` — *${p.status}*` : '';
        return `${idx + 1}. **${name}**${status}`;
      });

      const rep = isEn
        ? `${greetingPrefix}You currently have ${projects.length} project(s) registered under your account:\n\n${projLines.join('\n')}\n\nNo other new project was created just now. Would you like to create a new project?`
        : `${greetingPrefix}Aapke registered project(s) ye hain:\n\n${projLines.join('\n')}\n\nAbhi koi naya project create nahi kiya hai. Agar aap naya project banana chahte hain, to "Naya project banana" par click karein.`;

      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: isEn ? `You have ${projects.length} existing projects.` : `Aapke paas ${projects.length} existing projects hain.`,
        speakText: rep,
        speakTextHi: `Aapke paas ${projects.length} existing projects hain.`,
        draft: null,
        chips: [
          { label: 'Naya project banana', action: { type: 'set_intent', intent: 'create_project' } },
          { label: 'Main menu', action: { type: 'reset' } },
        ],
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
    if (projects.length === 0) {
      const rep = isEn
        ? `${greetingPrefix}No active projects were found under your account. Would you like to create one?`
        : `${greetingPrefix}Aapke account mein koi active projects nahi mile. Kya aap naya project create karna chahte hain?`;
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: rep,
        speakText: rep,
        speakTextHi: rep,
        draft: null,
        chips: buildChips(null, 'welcome', { ...queryDeps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }

    const projLines = projects.map((p, idx) => {
      const name = p.projectName || p.name || 'Untitled';
      const status = p.status ? ` — *${p.status}*` : '';
      return `${idx + 1}. **${name}**${status}`;
    });

    const header = isEn
      ? `${greetingPrefix}You have access to ${projects.length} project(s):`
      : `${greetingPrefix}Aapke paas ${projects.length} project(s) ka access hai:`;
    const fullReply = `${header}\n\n${projLines.join('\n')}\n\n${isEn ? 'Would you like to add a task in a project or create a new one?' : 'Aap kisi project mein task banana chahte hain ya naya project?'}`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: fullReply,
      speech: isEn ? `You have access to ${projects.length} projects.` : `Aapke paas ${projects.length} projects hain.`,
      speakText: fullReply,
      speakTextHi: isEn ? null : `Aapke paas ${projects.length} projects hain.`,
      language: isEn ? 'en' : 'hinglish',
      draft: null,
      chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  // 2. Clients Query
  if (CRM_CLIENTS_QUERY_REGEX.test(message)) {
    if (!allowedIntents.includes('create_client') && !allowedIntents.includes('create_client_task')) {
      const denial = getPermissionDeniedReply('create_client', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }
    const rawClients = context.accessibleClients || deps.accessibleClients || [];
    const uniqueClientMap = new Map();
    for (const c of rawClients) {
      const cName = (c.client || c.name || 'Untitled').trim();
      const comp = (c.company || '').trim();
      const key = `${cName.toLowerCase()}::${comp.toLowerCase()}`;
      if (!uniqueClientMap.has(key)) {
        uniqueClientMap.set(key, c);
      }
    }
    const clients = Array.from(uniqueClientMap.values());
    if (clients.length === 0) {
      const rep = isEn
        ? `${greetingPrefix}No clients found in your CRM yet. Would you like to add a new client?`
        : `${greetingPrefix}Aapke CRM mein koi clients nahi mile. Kya aap naya client add karna chahte hain?`;
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: rep,
        speakText: rep,
        speakTextHi: isEn ? null : rep,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...queryDeps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }

    const clientLines = clients.map((c, idx) => {
      const name = c.client || c.name || 'Untitled';
      const comp = c.company ? ` (${c.company})` : '';
      return `${idx + 1}. **${name}**${comp}`;
    });

    const header = isEn
      ? `${greetingPrefix}Here are ${clients.length} client(s) registered in your CRM:`
      : `${greetingPrefix}Aapke CRM mein ${clients.length} client(s) registered hain:`;
    const fullReply = `${header}\n\n${clientLines.join('\n')}\n\n${isEn ? 'Would you like to add a client or assign a task?' : 'Aap client add karna chahte hain ya client task?'}`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: fullReply,
      speech: isEn ? `Found ${clients.length} clients in your CRM.` : `CRM mein ${clients.length} clients mile.`,
      speakText: fullReply,
      speakTextHi: isEn ? null : `CRM mein ${clients.length} clients mile.`,
      language: isEn ? 'en' : 'hinglish',
      draft: null,
      chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  // 3. Tasks Query
  if (CRM_TASKS_QUERY_REGEX.test(message)) {
    // Detect date filter (e.g. "aaj ke", "aj", "today", "kal", "tomorrow")
    const isToday = /\b(?:aaj|aj|today)\b/i.test(message);
    const isTomorrow = /\b(?:kal|tomorrow)\b/i.test(message) && !/\b(?:pichle|yesterday)\b/i.test(message);
    const isExplicitAll = /\b(?:all\s+tasks?|all\s+time|saare\s+tasks?|sare\s+tasks?|sab\s+tasks?|total\s+tasks?|all\s+type|all\b)/i.test(message);
    const isProjectSpecific = /\b(?:project\s+tasks?|project\s+ke\s+tasks?|project\s+task)\b/i.test(message);
    const isAssignedSpecific = /\b(?:assigned\s+to\s+me|assigned\s+tasks?|mujhe\s+assign|assigned\s+task)\b/i.test(message);
    const isClientSpecific = /\b(?:client\s+tasks?|client\s+ke\s+tasks?|client\s+task)\b/i.test(message);
    const isPersonal = !isExplicitAll && !isProjectSpecific && !isAssignedSpecific && !isClientSpecific && (
      /\b(?:personal|self)\b/i.test(message) || (/\b(?:mera|meri|mere|apne)\b/i.test(message) && !/\b(?:all|saare|sare|sab|total|assigned|client|project)\b/i.test(message))
    );
    const dayRange = getIstDayRange(context.now || deps.now || new Date());

    // Detect desired status filter from user query
    let statusFilter = null;
    let statusLabel = isToday ? (isPersonal ? "today's personal" : "today's") : (isTomorrow ? "tomorrow's" : (isPersonal ? "personal" : (isExplicitAll ? 'all' : 'recent')));
    let statusLabelHi = isToday ? (isPersonal ? "aaj ke personal" : "aaj ke") : (isTomorrow ? "kal ke" : (isPersonal ? "personal" : (isExplicitAll ? 'sab' : 'haal ke')));

    if (/\b(?:in[- ]progress|chalu|chal\s+raha)\b/i.test(message)) {
      statusFilter = { $in: ['in-progress', 'in progress'] };
      statusLabel = isToday ? "today's in-progress" : 'In-Progress';
      statusLabelHi = isToday ? 'aaj ke in-progress' : 'In-Progress';
    } else if (/\b(?:pending|baaki|incomplete)\b/i.test(message)) {
      statusFilter = 'pending';
      statusLabel = isToday ? "today's pending" : 'Pending';
      statusLabelHi = isToday ? 'aaj ke pending' : 'Pending';
    } else if (/\b(?:completed|done|complete|khatam)\b/i.test(message)) {
      statusFilter = 'completed';
      statusLabel = isToday ? "today's completed" : 'Completed';
      statusLabelHi = isToday ? 'aaj ke completed' : 'Completed';
    } else if (/\b(?:overdue|late)\b/i.test(message)) {
      statusFilter = 'overdue';
      statusLabel = 'Overdue';
      statusLabelHi = 'Overdue';
    }

    let tasks = Array.isArray(deps.tasks) ? deps.tasks : [];

    if (tasks.length === 0 && (deps.Task || mongoose?.connection?.readyState === 1)) {
      let taskHelper = null;
      try {
        taskHelper = require('../../HR-CDS/controllers/taskHelper');
      } catch (e) {
        taskHelper = null;
      }

      if (taskHelper && typeof taskHelper.fetchPersonalTaskList === 'function' && req?.user) {
        try {
          const taskReq = {
            user: req.user,
            query: { ...req?.query, dateField: 'reportDate' }
          };

          if (isPersonal) {
            tasks = await taskHelper.fetchPersonalTaskList(taskReq, { lightweight: true });
          } else if (isProjectSpecific) {
            tasks = await taskHelper.fetchAssignedProjectTaskList(taskReq);
          } else if (isAssignedSpecific) {
            tasks = await taskHelper.fetchAssignedToMeTaskList(taskReq, { lightweight: true });
          } else if (isClientSpecific) {
            tasks = await taskHelper.fetchAssignedClientTaskList(taskReq, { lightweight: true });
          } else {
            // view === 'all' (unified: personal + assigned + client + project)
            const [personal, assigned, client, project] = await Promise.all([
              taskHelper.fetchPersonalTaskList(taskReq, { lightweight: true }).catch(() => []),
              taskHelper.fetchAssignedToMeTaskList(taskReq, { lightweight: true }).catch(() => []),
              taskHelper.fetchAssignedClientTaskList(taskReq, { lightweight: true }).catch(() => []),
              taskHelper.fetchAssignedProjectTaskList(taskReq).catch(() => [])
            ]);
            tasks = [...(personal || []), ...(assigned || []), ...(client || []), ...(project || [])];
          }
        } catch (err) {
          console.warn('[taskAgentService] Error reading unified tasks from taskHelper:', err?.message || err);
        }
      }

      // Fallback to TaskModel.find if taskHelper didn't return tasks (or in unit tests)
      if (tasks.length === 0) {
        const TaskModel = deps.Task || mongoose.models.Task || require('../../HR-CDS/models/Task');
        if (TaskModel && typeof TaskModel.find === 'function') {
          try {
            const andConditions = [
              { isActive: { $ne: false } }
            ];

            if (companyCodeFilter) {
              const baseCode = typeof companyCodeFilter === 'string' ? companyCodeFilter.split('-')[0].trim() : '';
              andConditions.push({
                companyCode: baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCodeFilter
              });
            }

            if (isPersonal) {
              andConditions.push({
                $or: [
                  { taskFor: 'self' },
                  { taskFor: { $exists: false } }
                ]
              });
            }

            if (statusFilter) {
              andConditions.push({ overallStatus: statusFilter });
            }

            if (isToday) {
              andConditions.push({
                $or: [
                  { dueDateTime: { $gte: dayRange.start, $lte: dayRange.end } },
                  { dueDate: { $gte: dayRange.start, $lte: dayRange.end } }
                ]
              });
            } else if (isTomorrow) {
              const tomStart = new Date(dayRange.start.getTime() + 86400000);
              const tomEnd = new Date(dayRange.end.getTime() + 86400000);
              andConditions.push({
                $or: [
                  { dueDateTime: { $gte: tomStart, $lte: tomEnd } },
                  { dueDate: { $gte: tomStart, $lte: tomEnd } }
                ]
              });
            }

            if (userId) {
              andConditions.push({
                $or: [
                  { createdBy: userId },
                  { assignedUser: userId },
                  { 'assignedUsers.user': userId },
                  { user: userId }
                ]
              });
            }

            const filter = { $and: andConditions };
            tasks = await TaskModel.find(filter)
              .sort({ createdAt: -1 })
              .limit(100)
              .lean();
          } catch (e) {
            console.warn('[taskAgentService] Error reading tasks:', e);
          }
        }
      }
    }

    if (tasks.length > 0) {
      if (isPersonal) {
        tasks = tasks.filter(t => !t.taskFor || t.taskFor === 'self' || String(t.taskSource || t.__taskSource || '').includes('self'));
      }
      if (statusFilter) {
        if (typeof statusFilter === 'string') {
          if (statusFilter === 'overdue') {
            tasks = tasks.filter(t => t.isOverdue || String(t.overallStatus || t.status || '').toLowerCase() === 'overdue');
          } else {
            tasks = tasks.filter(t => String(t.overallStatus || t.status || '').toLowerCase() === statusFilter.toLowerCase());
          }
        } else if (statusFilter.$in) {
          tasks = tasks.filter(t => statusFilter.$in.some(st => String(t.overallStatus || t.status || '').toLowerCase().includes(st)));
        }
      }
      if (isToday) {
        tasks = tasks.filter(t => {
          const d = t.dueDateTime || t.dueDate;
          if (!d) return false;
          const time = new Date(d).getTime();
          return time >= dayRange.start.getTime() && time <= dayRange.end.getTime();
        });
      } else if (isTomorrow) {
        const tomStart = new Date(dayRange.start.getTime() + 86400000);
        const tomEnd = new Date(dayRange.end.getTime() + 86400000);
        tasks = tasks.filter(t => {
          const d = t.dueDateTime || t.dueDate;
          if (!d) return false;
          const time = new Date(d).getTime();
          return time >= tomStart.getTime() && time <= tomEnd.getTime();
        });
      }
    }

    if (!tasks || tasks.length === 0) {
      let rep = '';
      if (isToday) {
        rep = isEn
          ? `${greetingPrefix}You don't have any ${isPersonal ? 'personal ' : ''}tasks scheduled for today (0 tasks today). Your dashboard schedule is clear! 😊 Would you like to create a new task?`
          : `${greetingPrefix}Aapka aaj ka koi ${isPersonal ? 'personal ' : ''}task scheduled nahi hai (aaj ke 0 tasks hain). Dashboard ke anusaar aaj ka schedule clear hai! 😊 Kya aap naya task banana chahte hain?`;
      } else {
        rep = isEn
          ? `${greetingPrefix}You don't have any ${statusLabel} tasks right now. Would you like to create one?`
          : `${greetingPrefix}Aapke paas abhi koi ${statusLabelHi} task nahi hai. Kya aap naya task banana chahte hain?`;
      }
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: rep,
        speech: rep,
        speakText: rep,
        speakTextHi: isEn ? null : rep,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...queryDeps, language: lang, allowedIntents }),
        candidates: [],
        notices: [],
        canAssignOthers: context.canAssignOthers
      };
    }

    const taskLines = tasks.map((t, idx) => {
      const title = t.title || t.name || 'Untitled task';
      const rawStatus = t.overallStatus || t.status || 'Pending';
      const status = t.isOverdue && rawStatus !== 'completed' ? 'overdue' : rawStatus;
      const due = (t.dueDateTime || t.dueDate) ? ` (Due: ${formatHumanIstDate(t.dueDateTime || t.dueDate)})` : '';
      let typeLabel = '';
      if (t.projectName || t.projectId) {
        typeLabel = ` — *Project: ${t.projectName || 'Project Task'}*`;
      } else if (t.clientName || t.clientId) {
        typeLabel = ` — *Client: ${t.clientName || 'Client Task'}*`;
      } else if (t.taskSource === 'assigned' || t.__taskSource === 'assigned') {
        typeLabel = ` — *Assigned*`;
      } else if (t.taskSource === 'self' || t.__taskSource === 'self') {
        typeLabel = ` — *Personal*`;
      }
      return `${idx + 1}. **${title}** — *${status}*${typeLabel}${due}`;
    });

    const isCountQuery = /\b(?:how\s+many|kitne|kitna|count|total|कितने|संख्या)\b/i.test(message);
    const pendingCount = tasks.filter(t => String(t.overallStatus || t.status || '').toLowerCase().includes('pending')).length;
    const overdueCount = tasks.filter(t => t.isOverdue || String(t.overallStatus || t.status || '').toLowerCase().includes('overdue')).length;
    const completedCount = tasks.filter(t => String(t.overallStatus || t.status || '').toLowerCase().includes('completed') || String(t.overallStatus || t.status || '').toLowerCase().includes('done')).length;

    let header;
    if (isCountQuery) {
      header = isEn
        ? `${greetingPrefix}You have **${tasks.length} task(s)** in total (${pendingCount} pending, ${overdueCount} overdue, ${completedCount} completed):`
        : `${greetingPrefix}Aapke paas kul **${tasks.length} task(s)** hain (${pendingCount} pending, ${overdueCount} overdue, ${completedCount} completed):`;
    } else {
      header = isEn
        ? `${greetingPrefix}Here are your ${statusLabel} tasks (${tasks.length} found):`
        : `${greetingPrefix}Aapke ${statusLabelHi} tasks ye hain (${tasks.length} mile):`;
    }
    const prompt = isEn
      ? "\nWhat would you like to do next?"
      : "\nAap aage kya karna chahte hain?";

    const fullReply = `${header}\n\n${taskLines.join('\n')}\n${prompt}`;
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: fullReply,
      speech: isEn ? `Here are your ${statusLabel} tasks. ${tasks.length} found.` : `Aapke ${statusLabelHi} tasks ye hain (${tasks.length} mile).`,
      speakText: fullReply,
      speakTextHi: isEn ? null : `Aapke ${tasks.length} tasks mile.`,
      language: isEn ? 'en' : 'hinglish',
      draft: null,
      chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  return null;
}

function applyTaskStatusAndPriority(taskDoc, targetStatus, targetPriority, userId) {
  if (!taskDoc) return;
  const now = new Date();
  if (targetPriority) {
    taskDoc.priority = targetPriority.toLowerCase();
  }
  if (targetStatus) {
    const normalized = targetStatus.toLowerCase();
    taskDoc.status = normalized;
    taskDoc.overallStatus = normalized;

    if (normalized === 'completed') {
      taskDoc.completed = true;
      taskDoc.completedAt = now;
      taskDoc.completionDate = now;
    } else {
      taskDoc.completed = false;
      taskDoc.completedAt = null;
      taskDoc.completionDate = null;
    }

    if (!Array.isArray(taskDoc.statusByUser)) {
      taskDoc.statusByUser = [];
    }

    const uidStr = String(userId || '');
    let matchedUser = false;
    taskDoc.statusByUser.forEach(s => {
      const sUid = String(s.user?._id || s.user || '');
      if ((uidStr && sUid === uidStr) || taskDoc.taskFor === 'self') {
        s.status = normalized;
        s.updatedAt = now;
        s.statusChangedAt = now;
        s.remarks = `Status updated to ${normalized} via AI Assistant`;
        matchedUser = true;
      }
    });

    if (!matchedUser && (uidStr || taskDoc.taskFor === 'self')) {
      taskDoc.statusByUser.push({
        user: userId || taskDoc.createdBy,
        status: normalized,
        updatedAt: now,
        statusChangedAt: now,
        remarks: `Status updated to ${normalized} via AI Assistant`
      });
    }

    if (!Array.isArray(taskDoc.statusHistory)) {
      taskDoc.statusHistory = [];
    }
    taskDoc.statusHistory.push({
      status: normalized,
      changedBy: userId || taskDoc.createdBy,
      changedByType: 'user',
      remarks: `Status updated to ${normalized} via AI Assistant`,
      changedAt: now
    });

    if (typeof taskDoc.markModified === 'function') {
      taskDoc.markModified('statusByUser');
      taskDoc.markModified('statusHistory');
    }

    taskDoc.lastActivityAt = now;
  }
}

async function handleCrmUpdate(message, req, deps = {}, lang = 'hinglish', context = {}) {
  const isEn = lang === 'en';
  const userId = req?.user?._id || req?.user?.id;
  const rawCompanyCode = req?.user?.companyCode || req?.user?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  const clients = context.accessibleClients || deps.accessibleClients || [];
  const projects = context.accessibleProjects || deps.accessibleProjects || [];
  const isDbConnected = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);

  // 0. Check Project Status / Priority Update:
  // e.g. "Change the status of this project, make it planning."
  // e.g. "Change the status of ai agent project to planning"
  // e.g. "ai agent project ka status planning kardo"
  // e.g. "make project active", "status planning kardo"
  let targetProjectStatus = null;
  if (/\b(?:planning|plan)\b/i.test(message)) targetProjectStatus = 'planning';
  else if (/\b(?:active)\b/i.test(message)) targetProjectStatus = 'active';
  else if (/\b(?:complete|completed|done|khatam|safal)\b/i.test(message)) targetProjectStatus = 'completed';
  else if (/\b(?:on[- ]?hold|hold)\b/i.test(message)) targetProjectStatus = 'on hold';
  else if (/\b(?:cancel|cancelled|radd)\b/i.test(message)) targetProjectStatus = 'cancelled';

  let targetProjectPriority = null;
  if (/\b(?:high|urgent|zaroori)\b/i.test(message)) targetProjectPriority = 'high';
  else if (/\b(?:medium|normal)\b/i.test(message)) targetProjectPriority = 'medium';
  else if (/\b(?:low)\b/i.test(message)) targetProjectPriority = 'low';

  const targetProject = findReferencedProject(message, projects, context.draft) ||
    (context.draft?.lastProjectId ? projects.find(p => String(p._id || p.id) === String(context.draft.lastProjectId)) : null);

  const mentionsProjectExplicitly = /\b(?:project|projekts?)\b/i.test(message) || Boolean(context.draft?.lastProjectId);
  const mentionsTaskExplicitly = /\b(?:task|tasks|taks)\b/i.test(message);

  const isProjectUpdate = Boolean(
    targetProject &&
    (targetProjectStatus || targetProjectPriority) &&
    (
      targetProjectStatus === 'planning' ||
      targetProjectStatus === 'active' ||
      (mentionsProjectExplicitly && !mentionsTaskExplicitly)
    )
  );

  if (isProjectUpdate) {
    const allowedIntents = resolveUserAllowedIntents(req?.user, context.scope, deps);
    if (!allowedIntents.includes('create_project') && !allowedIntents.includes('task_project')) {
      const denial = getPermissionDeniedReply('create_project', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      };
    }
    const ProjectModel = deps.Project || DefaultProjectModel || (mongoose?.models?.Project) || (isDbConnected ? require('../../HR-CDS/models/Project').Project : null);
    const updatePayload = {};
    if (targetProjectStatus) updatePayload.status = targetProjectStatus;
    if (targetProjectPriority) updatePayload.priority = targetProjectPriority;

    if (isDbConnected && ProjectModel && targetProject._id) {
      try {
        await ProjectModel.updateOne(
          { _id: targetProject._id },
          { $set: updatePayload }
        );
      } catch (err) {
        console.warn('[taskAgentService] Error updating Project status in DB:', err);
      }
    }

    if (targetProjectStatus) targetProject.status = targetProjectStatus;
    if (targetProjectPriority) targetProject.priority = targetProjectPriority;

    const pName = targetProject.projectName || targetProject.name || 'Project';
    const updatedValue = targetProjectStatus || targetProjectPriority;
    const rep = isEn
      ? `Project **"${pName}"** status has been successfully updated to **${updatedValue}**! ✅\n\nWould you like to check the project details or return to the main menu?`
      : `Project **"${pName}"** ka status safaltapoorvak **${updatedValue}** update kar diya gaya hai! ✅\n\nKya aap is project ki details check karna chahte hain?`;

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: rep,
      speech: isEn ? `Project ${pName} status updated to ${updatedValue}.` : `Project ${pName} ka status ${updatedValue} update kar diya gaya hai.`,
      speakText: rep,
      speakTextHi: isEn ? null : `Project ${pName} ka status ${updatedValue} update kar diya gaya hai.`,
      language: isEn ? 'en' : 'hinglish',
      draft: {
        lastProjectId: String(targetProject._id || targetProject.id),
        lastProjectName: pName
      },
      chips: isEn ? [
        { label: 'Check project details', action: { type: 'view_project', projectId: String(targetProject._id || targetProject.id) } },
        { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(targetProject._id || targetProject.id) } },
        { label: 'Main menu', action: { type: 'reset' } }
      ] : [
        { label: `${pName} details dekhein`, action: { type: 'view_project', projectId: String(targetProject._id || targetProject.id) } },
        { label: 'Tasks dekhein', action: { type: 'view_project_tasks', projectId: String(targetProject._id || targetProject.id) } },
        { label: 'Main menu', action: { type: 'reset' } }
      ],
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  // 0b. Check Client / Client Plan Status Update:
  // e.g. "saniha client kai plan ka status active sai change karke on hold kardo"
  // e.g. "saniha client ka status on hold kardo"
  // e.g. "saniha client ke plan ko on hold kardo"
  // e.g. "saniha client ka plan active se on hold kardo"
  // e.g. "make saniha client on hold", "put saniha client on hold"
  const matchedClientForStatus = findReferencedClient(message, clients);
  let targetClientStatus = null;
  if (/\b(?:on[- ]?hold|hold)\b/i.test(message)) {
    targetClientStatus = 'On Hold';
  } else if (/\b(?:active|chalu)\b/i.test(message) && !/\bactive\s*(?:se|sai|sy|from)\b/i.test(message)) {
    targetClientStatus = 'Active';
  } else if (/\b(?:inactive|cancel|cancelled|band|close|closed|radd)\b/i.test(message)) {
    targetClientStatus = 'Inactive';
  }

  const mentionsPlanOrSub = /\b(?:plan|plaan|plans|subscription)\b/i.test(message);
  const mentionsTaskExplicit = /\b(?:task|tasks|taks|taask)\b/i.test(message);
  const mentionsClientWord = /\b(?:client|cleint|clint|ग्राहक)\b/i.test(message);

  const isClientStatusUpdate = Boolean(
    matchedClientForStatus &&
    targetClientStatus &&
    !mentionsTaskExplicit &&
    (mentionsPlanOrSub || mentionsClientWord || !targetProject)
  );

  if (isClientStatusUpdate) {
    const allowedIntents = resolveUserAllowedIntents(req?.user, context.scope, deps);
    if (!allowedIntents.includes('create_client')) {
      const denial = getPermissionDeniedReply('create_client', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      };
    }
    const ClientModel = deps.Client || (mongoose.models && mongoose.models.Client) || (isDbConnected ? require('../../HR-CDS/models/Client') : null);
    const clientDisplayName = matchedClientForStatus.client || matchedClientForStatus.name || 'Client';
    const compStr = matchedClientForStatus.company ? ` (*${matchedClientForStatus.company}*)` : '';

    if (isDbConnected && ClientModel && matchedClientForStatus._id) {
      try {
        await ClientModel.updateOne(
          { _id: matchedClientForStatus._id },
          {
            $set: {
              status: targetClientStatus,
              'subscription.$[].status': targetClientStatus
            }
          }
        );
      } catch (err) {
        try {
          await ClientModel.updateOne(
            { _id: matchedClientForStatus._id },
            { $set: { status: targetClientStatus } }
          );
        } catch (err2) {
          console.warn('[taskAgentService] Error updating Client status in DB:', err2);
        }
      }
    }

    matchedClientForStatus.status = targetClientStatus;
    if (Array.isArray(matchedClientForStatus.subscription)) {
      matchedClientForStatus.subscription.forEach(s => {
        if (s) s.status = targetClientStatus;
      });
    }

    const rep = mentionsPlanOrSub
      ? (isEn
          ? `Client **"${clientDisplayName}"**${compStr} plan status has been successfully updated to **${targetClientStatus}**! ✅\n\nWould you like to check the client's CRM details or return to the main menu?`
          : `Client **"${clientDisplayName}"**${compStr} ke plan ka status safaltapoorvak **${targetClientStatus}** update kar diya gaya hai! ✅\n\nKya aap is client ki details check karna chahte hain?`)
      : (isEn
          ? `Client **"${clientDisplayName}"**${compStr} status has been successfully updated to **${targetClientStatus}**! ✅\n\nWould you like to check the client's CRM details or return to the main menu?`
          : `Client **"${clientDisplayName}"**${compStr} ka status safaltapoorvak **${targetClientStatus}** update kar diya gaya hai! ✅\n\nKya aap is client ki details check karna chahte hain?`);

    const clientChips = isEn ? [
      { label: 'Check client details', action: { type: 'set_intent', intent: 'view_client', client: clientDisplayName, clientId: String(matchedClientForStatus._id || matchedClientForStatus.id || '') } },
      { label: 'Main menu', action: { type: 'reset' } }
    ] : [
      { label: `${clientDisplayName} details dekhein`, action: { type: 'set_intent', intent: 'view_client', client: clientDisplayName, clientId: String(matchedClientForStatus._id || matchedClientForStatus.id || '') } },
      { label: 'Main menu', action: { type: 'reset' } }
    ];

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: rep,
      speech: isEn ? `Client ${clientDisplayName} plan status updated to ${targetClientStatus}.` : `Client ${clientDisplayName} ke plan ka status ${targetClientStatus} update kar diya gaya hai.`,
      speakText: rep,
      speakTextHi: isEn ? null : `Client ${clientDisplayName} ke plan ka status ${targetClientStatus} update kar diya gaya hai.`,
      language: isEn ? 'en' : 'hinglish',
      draft: null,
      chips: clientChips,
      candidates: [],
      notices: [],
      canAssignOthers: context.canAssignOthers
    };
  }

  const remarkMatch = message.match(/(?:with\s+remark|remark\s+hai|remark\s+mein|remark\s*:?)\s+["']?([^"'\n]+)["']?/i);
  const statusRemarkText = remarkMatch ? remarkMatch[1].trim() : null;
  let commandWithoutRemark = remarkMatch ? message.replace(remarkMatch[0], ' ') : message;

  // 1. Determine what property is being updated:
  // A. Priority:
  let targetPriority = null;
  const prioMatch = commandWithoutRemark.match(/(?:priority\s*(?:ko\s*)?(?:badal\s*kar\s*)?(high|low|medium)|(high|low|medium)\s*(?:priority|kardo|kar\s+do|rakho))/i);
  if (prioMatch) {
    const rawVal = (prioMatch[1] || prioMatch[2]).toLowerCase();
    if (rawVal === 'high') targetPriority = 'High';
    else if (rawVal === 'low') targetPriority = 'Low';
    else if (rawVal === 'medium') targetPriority = 'Medium';
  }

  // B. Status:
  let targetStatus = null;
  if (/in[- ]progress/i.test(commandWithoutRemark)) {
    targetStatus = 'in progress';
  } else if (/on[- ]?hold/i.test(commandWithoutRemark)) {
    targetStatus = 'on hold';
  } else if (/\bpending\b/i.test(commandWithoutRemark)) {
    targetStatus = 'pending';
  } else if (/\b(?:complete|completed|done|khatam|safal)\b/i.test(commandWithoutRemark)) {
    targetStatus = 'completed';
  }

  const titleMatch = message.match(/(?:title|naam)\s+(?:badal\s+ke|karke|to|set|rakho|karo)\s+["']?([^"'\n,]+)["']?/i);
  const editTitle = titleMatch ? titleMatch[1].trim() : null;

  const descMatch = message.match(/(?:description|desc|विवरण)\s+(?:badal\s+ke|karke|to|set|rakho|karo)\s+["']?([^"'\n,]+)["']?/i);
  const editDescription = descMatch ? descMatch[1].trim() : null;

  if (!targetPriority && !targetStatus && !editTitle && !editDescription) {
    return null; // Not an update command we can parse
  }

  // 2. Check if a client or service is mentioned:
  const matchedClient = findReferencedClient(message, clients);
  let matchedService = null;
  if (matchedClient && Array.isArray(matchedClient.services)) {
    matchedService = matchedClient.services.find(s => {
      const sName = typeof s === 'string' ? s : (s.service || s.name);
      if (!sName) return false;
      const lowerS = sName.toLowerCase();
      const lowerM = message.toLowerCase();
      if (lowerM.includes(lowerS)) return true;
      const sWords = lowerS.split(/\s+/).filter(w => w.length >= 4);
      return sWords.some(w => lowerM.includes(w) || lowerM.includes(w.slice(0, 4)));
    });
    if (typeof matchedService !== 'string' && matchedService) {
      matchedService = matchedService.service || matchedService.name;
    }
  }

  // 2b. Check if a project is mentioned or in context:
  let resolvedProj = targetProject;
  if (!resolvedProj) {
    const projectList = (Array.isArray(context.accessibleProjects) && context.accessibleProjects.length > 0)
      ? [...context.accessibleProjects]
      : (Array.isArray(deps.accessibleProjects) && deps.accessibleProjects.length > 0)
        ? [...deps.accessibleProjects]
        : (Array.isArray(deps.projects) && deps.projects.length > 0)
          ? [...deps.projects]
          : [];

    for (const p of projectList) {
      const pName = p.projectName || p.name || '';
      if (pName && new RegExp(`\\b${escapeRegex(pName)}\\b`, 'i').test(message)) {
        resolvedProj = p;
        break;
      }
    }
    if (!resolvedProj && (context.currentProjectId || context.lastProjectId)) {
      resolvedProj = projectList.find(p => String(p._id || p.id) === String(context.currentProjectId || context.lastProjectId));
    }
  }

  if (resolvedProj) {
    const pName = resolvedProj.projectName || resolvedProj.name;
    commandWithoutRemark = commandWithoutRemark.replace(
      new RegExp(`(?:\\b(?:in|for|of)\\s+)?(?:the\\s+)?${escapeRegex(pName)}\\s*(?:project)?(?:\\s+\\b(?:ke|ki|kai|ka|mein|me|in)\\b)?`, 'gi'),
      ' '
    ).replace(/\s+/g, ' ').trim();
  }

  // 3. Extract Task Name / Candidate:
  // e.g. "change the status of hlo task to completed"
  // e.g. "change the status of hlo task make it completed"
  // e.g. "mere Testing of CIIS AI assistant ka status change karke completed kardo"
  // e.g. "hlo1 task ko edit karke priority high kardo"
  let taskCandidate = null;

  // Pattern A: "change the status of <task> to <status>" / "change status of <task> make it <status>"
  const engStatusOfMatch = commandWithoutRemark.match(/\b(?:change|update|set)?\s*(?:the\s+)?(?:status|priority)\s+of\s+(.+?)(?:\s+task)?\s+(?:to|as|make\s+it)\s+(?:completed?|done|in[- ]progress|pending|on[- ]?hold|high|low|medium)/i);
  if (engStatusOfMatch && engStatusOfMatch[1]) {
    taskCandidate = engStatusOfMatch[1].trim();
  }

  // Pattern B: "mark <task> (task) as <status>" / "make <task> (task) <status>"
  if (!taskCandidate) {
    const markMatch = commandWithoutRemark.match(/\b(?:mark|set|make)\s+(?:task\s+)?(.+?)(?:\s+task)?\s+(?:as|to)?\s*(?:completed?|done|in[- ]progress|pending|on[- ]?hold|high|low|medium)\b/i);
    if (markMatch && markMatch[1]) {
      const cand = markMatch[1].trim();
      if (!['it', 'the', 'this', 'that', 'task'].includes(cand.toLowerCase())) {
        taskCandidate = cand;
      }
    }
  }

  // Pattern C: "change <task> (task) status to <status>" / "update <task> (task) status to <status>"
  if (!taskCandidate) {
    const changeMatch = commandWithoutRemark.match(/\b(?:change|update|set)\s+(?:the\s+)?(.+?)(?:\s+task)?\s+(?:status|priority)\s+(?:to|as|make\s+it)\s+(?:completed?|done|in[- ]progress|pending|on[- ]?hold|high|low|medium)/i);
    if (changeMatch && changeMatch[1]) {
      taskCandidate = changeMatch[1].trim();
    }
  }

  // Pattern D: Hinglish "mere/apne <task> task ka status completed kardo" / "<task> task ko edit karke priority high kardo"
  if (!taskCandidate) {
    const hinglishMatch = commandWithoutRemark.match(/(?:mere\s+|apne\s+)?(.+?)(?:\s+(?:task|kaam|kam))?\s*(?:ko|ka|ki)?\s*(?:edit\s*karke|status|priority)?\s*(?:change\s+karke|badal\s+kar|badal\s+ke|update\s+karke)?\s*(?:status|priority)?\s*(?:ko\s*)?(?:completed?|done|khatam|in[- ]progress|pending|on[- ]?hold|high|low|medium)\s*(?:kardo|kar\s*do|karo|rakho|set|mark)?/i);
    if (hinglishMatch && hinglishMatch[1]) {
      const cand = hinglishMatch[1].trim();
      if (cand.length >= 2 && !['is', 'es', 'this', 'naya', 'new', 'ye', 'the', 'task'].includes(cand.toLowerCase())) {
        taskCandidate = cand;
      }
    }
  }

  // Pattern E: Quoted string e.g. "hlo" task
  if (!taskCandidate) {
    const quoteMatch = commandWithoutRemark.match(/["']([^"']+)["']/);
    if (quoteMatch && quoteMatch[1] && !statusRemarkText?.includes(quoteMatch[1]) && !editDescription?.includes(quoteMatch[1])) {
      taskCandidate = quoteMatch[1].trim();
    }
  }

  // Pattern F: Fallback cleaning with full English & Hindi stopwords
  if (!taskCandidate) {
    let cleanedForTask = commandWithoutRemark;
    if (remarkMatch) cleanedForTask = cleanedForTask.replace(remarkMatch[0], ' ');
    if (descMatch) cleanedForTask = cleanedForTask.replace(descMatch[0], ' ');
    if (titleMatch) cleanedForTask = cleanedForTask.replace(titleMatch[0], ' ');

    if (matchedClient) {
      const cName = matchedClient.client || matchedClient.name;
      cleanedForTask = cleanedForTask.replace(new RegExp(escapeRegex(cName), 'gi'), ' ');
      if (matchedClient.company) {
        cleanedForTask = cleanedForTask.replace(new RegExp(escapeRegex(matchedClient.company), 'gi'), ' ');
      }
    }
    cleanedForTask = cleanedForTask.replace(/\b(?:client|cleint)\b/gi, ' ');
    if (matchedService) {
      cleanedForTask = cleanedForTask.replace(new RegExp(escapeRegex(matchedService), 'gi'), ' ');
    }
    cleanedForTask = cleanedForTask.replace(/\b(?:cloud|architecture|archetiecure|services?)\b/gi, ' ');
    cleanedForTask = cleanedForTask.replace(/\b(?:plan|plaan|plans|subscription)\b/gi, ' ');
    cleanedForTask = cleanedForTask.replace(/\b(?:active|planning|completed?|done|khatam|in[- ]progress|pending|on[- ]?hold|inactive|cancelled)\b/gi, ' ');

    cleanedForTask = cleanedForTask
      .replace(/(?:ka|ki|ke)?\s*(?:status|priority)?\s*(?:ko\s*)?(?:badal\s*kar\s*|change\s*(?:karke)?\s*|update\s*(?:karke)?\s*|set\s*(?:karke)?\s*|edit\s*(?:karke)?\s*)?(?:high|low|medium|completed?|done|khatam|in[- ]progress|pending|on[- ]?hold)\s*(?:kardo|kar\s*do|karo|banao|rakho|set|mark)?/gi, ' ')
      .replace(/(?:task|taks)?\s*(?:ko\s*)?(?:complete|done)\s*(?:mark\s*kardo|mark\s*karo|kardo|kar\s*do|mark)?/gi, ' ')
      .replace(/(?:status|priority)\s*(?:change|update|badal|set|edit)(?:\s*(?:karke|kardo|kar\s*do|karo))?/gi, ' ')
      .replace(/\b(?:status|priority|completed?|in[- ]progress|pending|on[- ]?hold|high|low|medium)\b/gi, ' ')
      .replace(/\b(?:task|taks|kardo|kar\s*do|kar|karo|edit|update|badal|change|set|mark|make|it)\b/gi, ' ')
      .replace(/\b(?:the|of|to|as|for|in|on|at|by|from|my|our|a|an|please|can|you|is|are|this|that)\b/gi, ' ')
      .replace(/\b(?:mai|mein|in|kai|ke|ki|ka|ko|par|pe|se|sai|sy|from|to|wala|wali|wale|change|karke|badal|badalkar)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedForTask.length >= 2 && !['naya', 'new', 'is', 'ye', 'kisi', 'mera', 'apna', 'plan', 'active', 'plan active', 'plan active sai'].includes(cleanedForTask.toLowerCase())) {
      taskCandidate = cleanedForTask;
    }
  }

  if (taskCandidate) {
    taskCandidate = taskCandidate
      .replace(/^(.+?)\s+project\s+(?:ke|ki|ka|kai|mein|me|in)\s+/i, '')
      .replace(/^(?:the|of|a|an|my|mere|apne|this|that)\s+/i, '')
      .replace(/^(?:the|of|a|an|my|mere|apne|this|that)\s+/i, '')
      .replace(/\s+(?:task\s+)?(?:in|for|of)\s+(?:the\s+)?(.+?)\s+project$/i, '')
      .replace(/\s+project$/i, '')
      .replace(/\s+(?:task|kam|kaam)$/i, '')
      .trim();
  }

  const isDbReady = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
  const isValidObjectId = (id) => Boolean(id && mongoose && mongoose.Types && mongoose.Types.ObjectId && mongoose.Types.ObjectId.isValid(id));
  const ClientTaskModel = deps.ClientTask || (mongoose && mongoose.models && mongoose.models.ClientTask) || (isDbReady ? require('../../HR-CDS/models/ClientTask') : null);
  const TaskModel = deps.Task || (mongoose && mongoose.models && mongoose.models.Task) || (isDbReady ? require('../../HR-CDS/models/Task') : null);
  const ProjectModel = deps.Project || DefaultProjectModel || (mongoose?.models?.Project) || (isDbReady ? require('../../HR-CDS/models/Project').Project : null);

  // SAFETY GUARD: If no task name could be extracted, prompt the user
  if (!taskCandidate) {
    let candidateTasks = [];
    if (matchedClient && Array.isArray(deps.clientTasks)) {
      candidateTasks = deps.clientTasks.filter(t => String(t.clientId) === String(matchedClient._id || matchedClient.id));
    } else if (matchedClient && isDbReady && ClientTaskModel && typeof ClientTaskModel.find === 'function') {
      try {
        candidateTasks = await ClientTaskModel.find({
          ...(isValidObjectId(matchedClient._id || matchedClient.id) ? { clientId: matchedClient._id || matchedClient.id } : {}),
          status: { $ne: 'completed' }
        }).sort({ createdAt: -1 }).limit(5).lean();
      } catch {}
    }

    if (candidateTasks.length > 0) {
      const taskChips = candidateTasks.map(t => ({
        label: t.name || t.title,
        action: {
          type: 'update_task_select',
          taskId: String(t._id || t.id),
          targetStatus,
          targetPriority,
          taskTitle: t.name || t.title
        }
      }));
      taskChips.push({ label: 'Main menu', action: { type: 'reset' } });

      const clientName = matchedClient ? (matchedClient.client || matchedClient.name) : '';
      const promptRep = isEn
        ? `Which task${clientName ? ` for ${clientName}` : ''} would you like to update? Please select or specify the task name:`
        : `${clientName ? `${clientName} ke ` : ''}kis task ko update karna hai? Task chuniye ya naam batayein:`;

      return {
        success: true,
        status: 'needs_input',
        field: 'task_select',
        reply: promptRep,
        speech: promptRep,
        speakText: promptRep,
        speakTextHi: promptRep,
        draft: null,
        chips: taskChips,
        candidates: [],
        notices: []
      };
    }

    const noTasksRep = isEn
      ? `Please specify the task name you want to update.`
      : `Kripya batayein kis task ko update karna hai (task ka naam batayein).`;
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: noTasksRep,
      speech: noTasksRep,
      speakText: noTasksRep,
      speakTextHi: noTasksRep,
      draft: null,
      chips: [
        { label: 'Tasks list dekhein', action: { type: 'show_tasks' } },
        { label: 'Main menu', action: { type: 'reset' } }
      ],
      candidates: [],
      notices: []
    };
  }

  let updatedDoc = null;
  let isClientTask = false;

  // 1. FIRST PRIORITY: Personal / Assigned Tasks (TaskModel & deps.tasks)
  // Check memory mock for Task (deps.tasks)
  if (!updatedDoc && Array.isArray(deps.tasks)) {
    const tTask = deps.tasks.find(t => {
      if (taskCandidate) return String(t.title || t.name).toLowerCase().includes(taskCandidate.toLowerCase());
      return false;
    });
    if (tTask) {
      applyTaskStatusAndPriority(tTask, targetStatus, targetPriority, userId);
      if (editTitle) tTask.title = editTitle;
      if (editDescription) tTask.description = editDescription;
      if (statusRemarkText) {
        if (!Array.isArray(tTask.remarks)) tTask.remarks = [];
        tTask.remarks.push({ user: userId, userName: req?.user?.name || 'User', text: statusRemarkText, createdAt: new Date() });
      }
      updatedDoc = tTask;
    }
  }

  // Live DB search for general TaskModel:
  if (!updatedDoc && isDbReady && TaskModel && typeof TaskModel.findOne === 'function') {
    try {
      const tQuery = {
        isActive: { $ne: false },
        ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
        title: { $regex: new RegExp(escapeRegex(taskCandidate), 'i') }
      };
      const tTask = await TaskModel.findOne(tQuery).sort({ createdAt: -1 });
      if (tTask) {
        applyTaskStatusAndPriority(tTask, targetStatus, targetPriority, userId);
        if (editTitle) tTask.title = editTitle;
        if (editDescription) tTask.description = editDescription;
        if (statusRemarkText) {
          if (!Array.isArray(tTask.remarks)) tTask.remarks = [];
          tTask.remarks.push({ user: userId, userName: req?.user?.name || 'User', text: statusRemarkText, createdAt: new Date() });
          if (typeof tTask.markModified === 'function') tTask.markModified('remarks');
        }
        if (typeof tTask.save === 'function') await tTask.save();
        updatedDoc = tTask;
      }
    } catch (e) {
      console.warn('[taskAgentService] Error updating TaskModel:', e);
    }
  }

  // 2. SECOND PRIORITY: Project tasks (ProjectModel & deps.accessibleProjects)
  const activeProjRef = resolvedProj || targetProject;
  if (!updatedDoc && (activeProjRef || context.accessibleProjects || deps.accessibleProjects || (isDbReady && (deps.Project || DefaultProjectModel || mongoose.models.Project)))) {
    // DB search for Project task first
    if (isDbReady && ProjectModel && typeof ProjectModel.findOne === 'function' && taskCandidate) {
      try {
        const projectQuery = {
          isActive: { $ne: false },
          ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
          'tasks.title': { $regex: new RegExp(escapeRegex(taskCandidate), 'i') }
        };
        if (activeProjRef && (activeProjRef._id || activeProjRef.id)) {
          projectQuery._id = activeProjRef._id || activeProjRef.id;
        }
        let pDoc = await ProjectModel.findOne(projectQuery);
        if (!pDoc && activeProjRef && (activeProjRef._id || activeProjRef.id)) {
          pDoc = await ProjectModel.findById(activeProjRef._id || activeProjRef.id);
        }
        if (pDoc && Array.isArray(pDoc.tasks)) {
          // RBAC Check for Project access
          if (!hasProjectAccess(pDoc, userId, req?.user?.role, req?.user)) {
            const denial = isEn
              ? `You do not have access to edit or update tasks in project "${pDoc.projectName}".`
              : `Aapke paas project "${pDoc.projectName}" ke tasks ko update ya edit karne ka access nahi hai.`;
            return {
              success: false,
              status: 'open',
              field: 'welcome',
              reply: denial,
              speech: denial,
              speakText: denial,
              draft: null,
              chips: [{ label: 'Main menu', action: { type: 'reset' } }],
              candidates: [],
              notices: []
            };
          }

          const tItem = pDoc.tasks.find(t => t.title && new RegExp(escapeRegex(taskCandidate), 'i').test(t.title));
          if (tItem) {
            const normStatus = targetStatus ? targetStatus.toLowerCase() : null;
            const nextProjectStatus = normStatus === 'in-progress' ? 'in progress' : (normStatus === 'onhold' ? 'on hold' : normStatus);
            const now = new Date();
            const updateFields = {
              "tasks.$.updatedAt": now,
              "tasks.$.statusChangedAt": now
            };
            if (nextProjectStatus) {
              updateFields["tasks.$.status"] = nextProjectStatus;
              tItem.status = nextProjectStatus;
              if (nextProjectStatus === 'completed') {
                updateFields["tasks.$.completionDate"] = now;
                tItem.completionDate = now;
              } else if (tItem.completionDate) {
                updateFields["tasks.$.completionDate"] = null;
                tItem.completionDate = null;
              }
            }
            if (targetPriority) {
              const pNorm = targetPriority.toLowerCase();
              updateFields["tasks.$.priority"] = pNorm;
              tItem.priority = pNorm;
            }
            if (editTitle) {
              updateFields["tasks.$.title"] = editTitle;
              tItem.title = editTitle;
            }
            if (editDescription) {
              updateFields["tasks.$.description"] = editDescription;
              tItem.description = editDescription;
            }

            const activityLog = {
              type: nextProjectStatus ? "status_change" : "task_edit",
              description: nextProjectStatus ? `Status changed to ${nextProjectStatus} via CIIS AI` : "Task details updated via CIIS AI",
              oldValue: tItem.status,
              newValue: nextProjectStatus || tItem.status,
              performedBy: userId,
              performedByName: req?.user?.name || 'User',
              remark: statusRemarkText || "Updated via CIIS AI",
              timestamp: now
            };

            const statusRemarkDoc = statusRemarkText ? {
              _id: new mongoose.Types.ObjectId(),
              mentions: [],
              text: statusRemarkText,
              createdBy: userId,
              userName: req?.user?.name || 'User',
              createdAt: now
            } : null;

            if (!Array.isArray(tItem.activityLogs)) tItem.activityLogs = [];
            tItem.activityLogs.push(activityLog);
            if (statusRemarkDoc) {
              if (!Array.isArray(tItem.remarks)) tItem.remarks = [];
              tItem.remarks.push(statusRemarkDoc);
            }

            await ProjectModel.updateOne(
              { _id: pDoc._id, "tasks._id": tItem._id },
              {
                $set: updateFields,
                $push: {
                  "tasks.$.activityLogs": activityLog,
                  ...(statusRemarkDoc ? { "tasks.$.remarks": statusRemarkDoc } : {})
                }
              }
            );

            if (typeof pDoc.markModified === 'function') pDoc.markModified('tasks');
            try {
              await pDoc.save();
            } catch (saveErr) {}

            updatedDoc = {
              ...(typeof tItem.toObject === 'function' ? tItem.toObject() : tItem),
              projectName: pDoc.projectName,
              projectId: String(pDoc._id || pDoc.id)
            };
          }
        }
      } catch (e) {
        console.warn('[taskAgentService] Error updating Project task in DB:', e);
      }
    }

    // Memory mock update fallback for Project tasks
    if (!updatedDoc) {
      const projList = context.accessibleProjects || deps.accessibleProjects || [];
      for (const p of projList) {
        if (Array.isArray(p.tasks)) {
          const foundTask = p.tasks.find(t => taskCandidate && String(t.title || t.name).toLowerCase().includes(taskCandidate.toLowerCase()));
          if (foundTask) {
            if (targetPriority) foundTask.priority = targetPriority.toLowerCase();
            if (targetStatus) foundTask.status = targetStatus.toLowerCase();
            if (editTitle) foundTask.title = editTitle;
            if (editDescription) foundTask.description = editDescription;
            if (statusRemarkText) {
              if (!Array.isArray(foundTask.remarks)) foundTask.remarks = [];
              foundTask.remarks.push({ user: userId, text: statusRemarkText, createdAt: new Date() });
            }
            updatedDoc = { ...foundTask, projectName: p.projectName || p.name, projectId: String(p._id || p.id) };
            break;
          }
        }
      }
    }
  }

  // 3. THIRD PRIORITY: Client Tasks (ClientTaskModel & deps.clientTasks)
  // Only check client task if task was not found in personal tasks or project tasks
  if (!updatedDoc && (matchedClient || /\b(?:client|client\s+task|service)\b/i.test(message))) {
    const allowedIntents = resolveUserAllowedIntents(req?.user, context.scope, deps);
    if (!allowedIntents.includes('create_client') && !allowedIntents.includes('create_client_task')) {
      const denial = getPermissionDeniedReply('create_client', allowedIntents, req?.user, lang);
      return {
        success: true,
        status: 'open',
        field: 'welcome',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        language: isEn ? 'en' : 'hinglish',
        draft: null,
        chips: buildChips(null, 'welcome', { ...deps, language: lang, allowedIntents }),
      };
    }

    // Check memory mock for ClientTask (deps.clientTasks)
    if (!updatedDoc && matchedClient && Array.isArray(deps.clientTasks)) {
      const cTask = deps.clientTasks.find(t => {
        const matchClient = String(t.clientId) === String(matchedClient._id || matchedClient.id);
        const matchName = taskCandidate ? String(t.name || t.title).toLowerCase().includes(taskCandidate.toLowerCase()) : false;
        return matchClient && matchName;
      });
      if (cTask) {
        if (targetPriority) cTask.priority = targetPriority;
        if (targetStatus) {
          cTask.status = targetStatus;
          if (targetStatus === 'completed') cTask.completed = true;
        }
        updatedDoc = cTask;
        isClientTask = true;
      }
    }

    // Live DB search for ClientTask:
    if (!updatedDoc && matchedClient && isDbReady && ClientTaskModel && typeof ClientTaskModel.findOne === 'function') {
      try {
        const cQuery = {
          ...(isValidObjectId(matchedClient._id || matchedClient.id) ? { clientId: matchedClient._id || matchedClient.id } : {}),
          ...(matchedService ? { service: { $regex: new RegExp(escapeRegex(matchedService), 'i') } } : {}),
          name: { $regex: new RegExp(escapeRegex(taskCandidate), 'i') }
        };
        let cTask = await ClientTaskModel.findOne(cQuery).sort({ createdAt: -1 });
        if (!cTask && isValidObjectId(matchedClient._id || matchedClient.id)) {
          cTask = await ClientTaskModel.findOne({
            clientId: matchedClient._id || matchedClient.id,
            name: { $regex: new RegExp(escapeRegex(taskCandidate), 'i') }
          }).sort({ createdAt: -1 });
        }
        if (cTask) {
          if (targetPriority) cTask.priority = targetPriority;
          if (targetStatus) {
            cTask.status = targetStatus;
            if (targetStatus === 'completed') {
              cTask.completed = true;
              cTask.completedAt = new Date();
            }
          }
          if (typeof cTask.save === 'function') await cTask.save();
          updatedDoc = cTask;
          isClientTask = true;
        }
      } catch (e) {
        console.warn('[taskAgentService] Error updating ClientTask:', e);
      }
    }
  }

  // 5. Build Response
  if (updatedDoc) {
    const taskTitle = updatedDoc.name || updatedDoc.title || taskCandidate || 'Task';
    let changeDetails = '';
    let changeDetailsEn = '';
    if (targetPriority && targetStatus) {
      changeDetails = `priority **${targetPriority}** aur status **${targetStatus}**`;
      changeDetailsEn = `priority to **${targetPriority}** and status to **${targetStatus}**`;
    } else if (targetPriority) {
      changeDetails = `priority **${targetPriority}**`;
      changeDetailsEn = `priority to **${targetPriority}**`;
    } else if (targetStatus) {
      changeDetails = `status **${targetStatus}**`;
      changeDetailsEn = `status to **${targetStatus}**`;
    } else {
      changeDetails = `details`;
      changeDetailsEn = `details`;
    }

    const isProjTask = Boolean(updatedDoc.projectName || updatedDoc.projectId);
    const projIdStr = String(updatedDoc.projectId || '');
    const clientInfo = matchedClient ? ` (Client: **${matchedClient.client || matchedClient.name}**)` : (updatedDoc.projectName ? ` (Project: **${updatedDoc.projectName}**)` : '');

    let rep = isEn
      ? `Task **"${taskTitle}"**${clientInfo} has been successfully updated with ${changeDetailsEn}! ✅`
      : `Task **"${taskTitle}"**${clientInfo} ki ${changeDetails} safaltapoorvak update kar di gayi hai! ✅`;

    if (statusRemarkText) {
      rep += isEn ? `\n• **Remark added**: "${statusRemarkText}"` : `\n• **Remark**: "${statusRemarkText}"`;
    }
    if (editTitle) {
      rep += isEn ? `\n• **Title**: "${editTitle}"` : `\n• **Naya title**: "${editTitle}"`;
    }
    if (editDescription) {
      rep += isEn ? `\n• **Description**: "${editDescription}"` : `\n• **Description**: "${editDescription}"`;
    }

    const chips = [
      ...(isProjTask && projIdStr ? [
        { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: projIdStr } },
        { label: 'Project details', action: { type: 'view_project', projectId: projIdStr } }
      ] : [
        { label: 'Tasks list dekhein', action: { type: 'show_tasks' } }
      ]),
      ...(targetStatus !== 'completed' ? [{ label: 'Mark as completed', action: { type: isProjTask ? 'update_project_task_status' : 'complete_task', taskId: String(updatedDoc._id || updatedDoc.id || ''), projectId: projIdStr, targetStatus: 'completed' } }] : []),
      { label: 'Main menu', action: { type: 'reset' } }
    ];

    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: rep,
      speech: isEn ? `Task ${taskTitle} updated successfully.` : `Task ${taskTitle} safaltapoorvak update ho gaya hai.`,
      speakText: rep,
      speakTextHi: `Task ${taskTitle} safaltapoorvak update ho gaya hai.`,
      draft: null,
      taskUpdated: true,
      updatedTaskId: String(updatedDoc._id || updatedDoc.id || ''),
      updatedTask: typeof updatedDoc?.toObject === 'function' ? updatedDoc.toObject() : updatedDoc,
      chips,
      candidates: [],
      notices: []
    };
  }

  // If task was not found:
  const taskSearchName = taskCandidate ? `"${taskCandidate}"` : 'ye task';
  const notFoundRep = isEn
    ? `Could not find ${taskSearchName} in CRM to update. Please check the task name or open your tasks list.`
    : `CRM mein update karne ke liye ${taskSearchName} nahi mila. Kripya task ka naam check karein ya tasks list dekhein.`;

  return {
    success: true,
    status: 'open',
    field: 'welcome',
    reply: notFoundRep,
    speech: notFoundRep,
    speakText: notFoundRep,
    speakTextHi: notFoundRep,
    draft: null,
    chips: [
      { label: 'Tasks list dekhein', action: { type: 'show_tasks' } },
      { label: 'Main menu', action: { type: 'reset' } }
    ],
    candidates: [],
    notices: []
  };
}

const INTENT_PAGE_NAMES_EN = {
  create_client: 'Client',
  create_client_plan: 'Client Plans',
  create_client_task: 'Create Task',
  create_project: 'Projects',
  task_project: 'Projects',
  task_assigned_user: 'Task Assignment',
  self_task: 'Personal Tasks',
};

const INTENT_PAGE_NAMES_HI = {
  create_client: 'Client',
  create_client_plan: 'Client Plans',
  create_client_task: 'Create Task',
  create_project: 'Projects',
  task_project: 'Projects',
  task_assigned_user: 'Task Assignment',
  self_task: 'Personal Tasks',
};

const INTENT_NAMES_EN = {
  self_task: 'Personal tasks',
  task_assigned_user: 'Assigning tasks',
  create_project: 'Creating projects',
  task_project: 'Project tasks',
  create_client: 'Client management',
  create_client_plan: 'Client plans',
  create_client_task: 'Client tasks',
};

function resolveUserAllowedIntents(user, scope = {}, deps = {}) {
  const ALL_INTENTS = [
    'self_task',
    'task_assigned_user',
    'create_project',
    'task_project',
    'create_client',
    'create_client_plan',
    'create_client_task',
  ];

  if (!user) return ['self_task'];

  const roleValues = [user.companyRole, user.role, user.jobRole, user.jobRoleName]
    .filter(Boolean)
    .map((r) => String(typeof r === 'object' ? r.name || r.role || '' : r).trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const PRIVILEGED_ROLES = new Set([
    'owner',
    'company_owner',
    'companyowner',
    'admin',
    'super_admin',
    'superadmin',
  ]);

  if (roleValues.some((r) => PRIVILEGED_ROLES.has(r)) || Boolean(user.isSuperAdmin || user.isPlatformOwner)) {
    return ALL_INTENTS;
  }

  const userPerms = [
    ...(Array.isArray(user?.allowedPages) ? user.allowedPages : []),
    ...(Array.isArray(user?.pagePermissions) ? user.pagePermissions : []),
    ...(Array.isArray(user?.permissions) ? user.permissions : []),
    ...(Array.isArray(deps?.sidebarMenuItems) ? deps.sidebarMenuItems : []),
    ...(Array.isArray(deps?.menuItems) ? deps.menuItems : []),
  ];

  const hasExplicitRestrictions = Boolean(
    (Array.isArray(user?.allowedPages) && user.allowedPages.length > 0) ||
    (Array.isArray(user?.pagePermissions) && user.pagePermissions.length > 0) ||
    (Array.isArray(user?.permissions) && user.permissions.length > 0) ||
    (Array.isArray(deps?.sidebarMenuItems) && deps.sidebarMenuItems.length > 0) ||
    (Array.isArray(deps?.menuItems) && deps.menuItems.length > 0)
  );

  const normalizedPerms = new Set();
  userPerms.forEach((p) => {
    if (typeof p === 'object' && p !== null) {
      [p.page, p.name, p.path, p.id, p.key].filter(Boolean).forEach((val) => {
        normalizedPerms.add(
          String(val).trim().toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, '').replace(/[\s_-]+/g, '')
        );
      });
    } else if (p) {
      normalizedPerms.add(
        String(p).trim().toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, '').replace(/[\s_-]+/g, '')
      );
    }
  });

  const allowed = ['self_task'];

  // Assigning tasks to others requires "Admin Create Task" permission (not general Task Management)
  const canAssign = Boolean(
    scope.isOwner ||
    normalizedPerms.has('admintaskcreate') ||
    normalizedPerms.has('admincreatetask') ||
    normalizedPerms.has('admin-task-create') ||
    normalizedPerms.has('admin-create-task') ||
    normalizedPerms.has('ciisuser/admintaskcreate') ||
    normalizedPerms.has('ciisuser/admin-task-create') ||
    user?.permissions?.includes?.('admin-task-create') ||
    user?.permissions?.includes?.('admin-create-task')
  );
  if (canAssign) {
    allowed.push('task_assigned_user');
  }

  // Creating projects requires administrative project permission
  const canProj = scope.hasManageProjectsAccess || normalizedPerms.has('adminproject') || normalizedPerms.has('manageprojects') || normalizedPerms.has('ciisuser/adminproject');
  if (canProj) {
    allowed.push('create_project');
  }

  // Creating tasks in projects is allowed for anyone with My Projects / Project view or admin project access
  const hasProjects = canProj ||
    normalizedPerms.has('projects') ||
    normalizedPerms.has('project') ||
    normalizedPerms.has('myprojects') ||
    normalizedPerms.has('myproject') ||
    normalizedPerms.has('ciisuser/project') ||
    Boolean(user?.hasProjects) ||
    (Array.isArray(deps?.accessibleProjects) && deps.accessibleProjects.length > 0) ||
    (Array.isArray(deps?.projects) && deps.projects.length > 0);
  if (hasProjects) {
    allowed.push('task_project');
  }

  const canClient = scope.hasClientManagementAccess || normalizedPerms.has('empclient') || normalizedPerms.has('clientmanagement') || normalizedPerms.has('emp-client') || normalizedPerms.has('ciisuser/empclient');
  if (canClient) {
    allowed.push('create_client');
  }

  // Users with "Create Task" / Task Management page or client management can create client tasks:
  // In CIIS, the "Create Task" page (/ciisUser/task-management) is accessible to all logged-in company users/employees by default.
  const hasCreateTaskPage = Boolean(
    normalizedPerms.has('taskmanagement') ||
    normalizedPerms.has('createtask') ||
    normalizedPerms.has('create-task') ||
    normalizedPerms.has('task-management') ||
    normalizedPerms.has('ciisuser/taskmanagement') ||
    normalizedPerms.has('ciisuser/createtask') ||
    normalizedPerms.has('ciisuser/task-management') ||
    normalizedPerms.has('ciisuser/create-task') ||
    normalizedPerms.has('task_management') ||
    normalizedPerms.has('create_task') ||
    normalizedPerms.has('mytasks') ||
    normalizedPerms.has('my-tasks') ||
    normalizedPerms.has('tasks') ||
    normalizedPerms.has('task') ||
    canClient ||
    !hasExplicitRestrictions ||
    (Array.isArray(deps?.allowedIntents) && deps.allowedIntents.includes('create_client_task'))
  );
  if (hasCreateTaskPage) {
    if (!allowed.includes('create_client_task')) {
      allowed.push('create_client_task');
    }
  }

  const canPlan = normalizedPerms.has('clientplans') || normalizedPerms.has('clientplan') || normalizedPerms.has('ciisuser/clientplans');
  if (canPlan) {
    allowed.push('create_client_plan');
  }

  if (Array.isArray(deps.allowedIntents) && deps.allowedIntents.length > 0) {
    if (deps.allowedIntents.includes('create_client_task') && !allowed.includes('create_client_task')) {
      allowed.push('create_client_task');
    }
    const valid = new Set(allowed);
    const result = deps.allowedIntents.filter((i) => valid.has(i));
    if (allowed.includes('create_client_task') && !result.includes('create_client_task')) {
      result.push('create_client_task');
    }
    return result;
  }

  return allowed;
}

function getPermissionDeniedReply(intent, allowedIntents = ['self_task'], user = null, lang = 'hinglish') {
  const isEn = lang === 'en';
  if (isEn) {
    const pageName = INTENT_PAGE_NAMES_EN[intent] || 'this';
    const allowedNames = allowedIntents
      .map((i) => INTENT_NAMES_EN[i] || i)
      .filter(Boolean)
      .join(', ');
    const optionsText = allowedNames ? ` You have access to: ${allowedNames}.` : '';
    const reply = `You do not have access to the ${pageName} page in your account, so I cannot perform this action.${optionsText}`;
    const speech = `You do not have access to the ${pageName} page in your account, so I cannot perform this action.`;
    return {
      reply,
      speech,
      speakText: reply,
      speakTextHi: null,
    };
  }

  const pageName = INTENT_PAGE_NAMES_HI[intent] || 'es';
  const allowedNames = allowedIntents
    .map((i) => INTENT_NAMES_HI[i] || i)
    .filter(Boolean)
    .join(', ');
  const optionsText = allowedNames ? ` Aapke paas ${allowedNames} ki suvidha uplabdh hai.` : '';
  const reply = `Aapke account mein ${pageName} page ka access nahi hai, isliye main yeh kaam nahi kar sakta.${optionsText}`;
  const speech = `Aapke account mein ${pageName} page ka access nahi hai, isliye main yeh kaam nahi kar sakta.`;
  const speakTextHi = `आपके अकाउंट में ${pageName} पेज का एक्सेस नहीं है, इसलिए मैं यह काम नहीं कर सकता।`;

  return { reply, speech, speakText: reply, speakTextHi };
}

async function parseTaskRequest({
  req,
  message,
  language = null,
  draft = {},
  pick = null,
  action = null,
}, deps = {}) {
  const now = deps.now instanceof Date ? deps.now : new Date();
  const extractFn = deps.extractFn || extractTaskDraft;
  const scopeInfoFn = deps.getScopeInfo || getScopeInfo;
  const isAssigneeInScopeFn = deps.isAssigneeInScope || isAssigneeInScope;
  const resolveAssigneeFn = deps.resolveAssignee || resolveAssignee;
  const UserModel = deps.User || User;
  const DeptModel = deps.Department || Department;
  const isDbReady = Boolean(deps.User || deps.Department || (mongoose && mongoose.connection && mongoose.connection.readyState === 1));
  const modelName = deps.getModelName ? deps.getModelName() : getModelName();
  const isEn = (language || draft?.language) === 'en';

  // Initialize draft structure
  const currentDraft = {
    title: draft?.title ?? null,
    description: draft?.description ?? null,
    dueDateTime: draft?.dueDateTime ?? null,
    priority: draft?.priority ?? null,
    status: draft?.status ?? null,
    reminder: draft?.reminder ?? null,
    reminderOption: draft?.reminderOption ?? null,
    repeatIntervalMinutes: draft?.repeatIntervalMinutes ?? null,
    minutesBeforeDue: draft?.minutesBeforeDue ?? null,
    customTime: draft?.customTime ?? null,
    reminderTime: draft?.reminderTime ?? null,
    reminderSettings: draft?.reminderSettings ?? null,
    priorityDays: draft?.priorityDays ?? null,
    repeatPattern: draft?.repeatPattern ?? null,
    repeatDays: Array.isArray(draft?.repeatDays) ? [...draft.repeatDays] : [],
    recurrenceEndDate: draft?.recurrenceEndDate ?? null,
    checkpoints: Array.isArray(draft?.checkpoints) ? [...draft.checkpoints] : [],
    assignee: draft?.assignee ?? draft?.assigneeName ?? null,
    assigneeName: draft?.assigneeName ?? draft?.assignee ?? null,
    assigneeId: draft?.assigneeId ?? null,
    assigneeLabel: draft?.assigneeLabel ?? null,
    assignees: Array.isArray(draft?.assignees) ? [...draft.assignees] : [],
    assignedUsers: Array.isArray(draft?.assignedUsers) ? [...draft.assignedUsers] : [],
    pendingAssigneeNames: Array.isArray(draft?.pendingAssigneeNames) ? [...draft.pendingAssigneeNames] : [],
    allMentionedAssignees: Array.isArray(draft?.allMentionedAssignees) ? [...draft.allMentionedAssignees] : [],
    removedAssignees: Array.isArray(draft?.removedAssignees) ? [...draft.removedAssignees] : [],
    assigneeLedger: Array.isArray(draft?.assigneeLedger) ? draft.assigneeLedger.map(e => ({ ...e })) : [],
    suggestedAssignee: draft?.suggestedAssignee ?? null,
    titlePersonCandidate: draft?.titlePersonCandidate ?? null,
    titlePersonHandled: Boolean(draft?.titlePersonHandled),
    branchId: draft?.branchId ?? null,
    intent: draft?.intent || (draft?.taskFor === 'others' ? 'task_assigned_user' : 'self_task'),
    taskFor: draft?.taskFor || 'self',
    wantsOthers: Boolean(draft?.wantsOthers),
    projectId: draft?.projectId ?? null,
    projectName: draft?.projectName ?? null,
    dueDate: draft?.dueDate ?? draft?.dueDateTime ?? null,
    file: draft?.file ?? null,
    pdfFile: draft?.pdfFile ?? null,
    askCounts: typeof draft?.askCounts === 'object' && draft?.askCounts ? { ...draft.askCounts } : {},
    skipped: Array.isArray(draft?.skipped) ? [...draft.skipped] : [],
    asked: Array.isArray(draft?.asked) ? [...draft.asked] : [],
    attachmentsCount: typeof draft?.attachmentsCount === 'number' ? draft.attachmentsCount : 0,
    name: draft?.name ?? draft?.projectName ?? null,
    startDate: draft?.startDate ?? null,
    endDate: draft?.endDate ?? null,
    members: Array.isArray(draft?.members) ? [...draft.members] : [],
    assigneeDone: Boolean(draft?.assigneeDone),
    duplicateHandled: Boolean(draft?.duplicateHandled),
    chainedTaskId: draft?.chainedTaskId ?? null,
    documentPdf: draft?.documentPdf ?? draft?.pdfFile ?? draft?.file ?? null,
    client: draft?.client ?? null,
    company: draft?.company ?? null,
    city: draft?.city ?? null,
    projectManager: Array.isArray(draft?.projectManager) ? [...draft.projectManager] : [],
    team: Array.isArray(draft?.team) ? [...draft.team] : [],
    language: draft?.language || null,
    moreDetailsDone: Boolean(draft?.moreDetailsDone),
    activeDetailsGroup: draft?.activeDetailsGroup ?? null,
    activeGroupField: draft?.activeGroupField ?? null,
    completedDetailsGroups: Array.isArray(draft?.completedDetailsGroups) ? [...draft.completedDetailsGroups] : [],
    skippedDetailsFields: Array.isArray(draft?.skippedDetailsFields) ? [...draft.skippedDetailsFields] : [],
    industry: draft?.industry ?? null,
    gst: draft?.gst ?? null,
    pan: draft?.pan ?? null,
    website: draft?.website ?? null,
    address: draft?.address ?? null,
    state: draft?.state ?? null,
    country: draft?.country ?? null,
    pincode: draft?.pincode ?? null,
    notes: draft?.notes ?? null,
    email: draft?.email ?? null,
    phone: draft?.phone ?? null,
    services: Array.isArray(draft?.services) ? [...draft.services] : [],
    clientPlanId: draft?.clientPlanId ?? null,
    clientPlanName: draft?.clientPlanName ?? null,
    clientPlanPrice: draft?.clientPlanPrice ?? null,
    clientPlanMonths: draft?.clientPlanMonths ?? null,
    clientPlanTasksCount: draft?.clientPlanTasksCount ?? null,
    subscriptionStartDate: draft?.subscriptionStartDate ?? null,
    subscriptionEndDate: draft?.subscriptionEndDate ?? null,
    companyLogo: draft?.companyLogo ?? null,
    companyLogoName: draft?.companyLogoName ?? null,
    servicesDone: Boolean(draft?.servicesDone),
    servicesSkipped: Boolean(draft?.servicesSkipped),
    serviceTasksDone: Boolean(draft?.serviceTasksDone),
    serviceTasksSkipped: Boolean(draft?.serviceTasksSkipped),
    addingServiceTasks: Boolean(draft?.addingServiceTasks),
    activeTaskService: draft?.activeTaskService ?? null,
    lastAddedService: draft?.lastAddedService ?? null,
    serviceTasks: draft?.serviceTasks ? JSON.parse(JSON.stringify(draft.serviceTasks)) : {},
    clientId: draft?.clientId ?? null,
    clientServices: Array.isArray(draft?.clientServices) ? [...draft.clientServices] : [],
    service: draft?.service ?? null,
    clientProjectManagers: Array.isArray(draft?.clientProjectManagers) ? [...draft.clientProjectManagers] : [],
    clientPlanDone: Boolean(draft?.clientPlanDone),
    clientPlanSkipped: Boolean(draft?.clientPlanSkipped),
    teamDone: Boolean(draft?.teamDone),
    membersDone: Boolean(draft?.membersDone),
    creatingManualPlan: Boolean(draft?.creatingManualPlan),
    price: draft?.price ?? null,
    months: draft?.months ?? null,
    descriptionDone: Boolean(draft?.descriptionDone),
    descriptionSkipped: Boolean(draft?.descriptionSkipped),
    manualPlan: draft?.manualPlan ? JSON.parse(JSON.stringify(draft.manualPlan)) : null,
    allowedPlanServices: Array.isArray(draft?.allowedPlanServices) ? [...draft.allowedPlanServices] : null,
    lastActiveType: draft?.lastActiveType ?? (draft?.lastClientId ? 'client' : (draft?.lastProjectId ? 'project' : null)),
    lastProjectId: draft?.lastProjectId ?? null,
    lastProjectName: draft?.lastProjectName ?? null,
    lastClientId: draft?.lastClientId ?? null,
    lastClientName: draft?.lastClientName ?? null,
    lastService: draft?.lastService ?? null,
    history: Array.isArray(draft?.history) ? [...draft.history] : (Array.isArray(req?.body?.history) ? [...req.body.history] : []),
    _lastReply: draft?._lastReply ?? null,
    _lastChipsKey: draft?._lastChipsKey ?? null,
    _lastUserMsg: draft?._lastUserMsg ?? null,
  };

  // Snapshot initially filled fields before turn execution
  const initialFilled = {
    title: Boolean(draft?.title && String(draft.title).trim()),
    description: Boolean(draft?.description !== null && draft?.description !== undefined && String(draft.description).trim()),
    dueDateTime: Boolean(draft?.dueDateTime && new Date(draft.dueDateTime).getTime() > now.getTime()),
    dueDate: Boolean(draft?.dueDate || (draft?.dueDateTime && new Date(draft.dueDateTime).getTime() > now.getTime())),
    project: Boolean(draft?.projectId || draft?.projectName),
    priority: Boolean(draft?.priority),
    status: Boolean(draft?.status),
    assignee: Boolean(draft?.assigneeId || (draft?.taskFor === 'others' && draft?.assigneeName)),
    reminder: Boolean(draft?.reminder !== null && draft?.reminder !== undefined),
    priorityDays: Boolean(draft?.priorityDays),
    repeatPattern: Boolean(draft?.repeatPattern),
    checkpoints: Boolean(Array.isArray(draft?.checkpoints) && draft.checkpoints.length > 0),
    name: Boolean(draft?.name && String(draft.name).trim()),
    startDate: Boolean(draft?.startDate),
    endDate: Boolean(draft?.endDate),
    members: Boolean(Array.isArray(draft?.members) && draft.members.length > 0),
    client: Boolean(draft?.client && String(draft.client).trim()),
    company: Boolean(draft?.company && String(draft.company).trim()),
    city: Boolean(draft?.city && String(draft.city).trim()),
    projectManager: Boolean((Array.isArray(draft?.projectManager) && draft.projectManager.length > 0) || (Array.isArray(draft?.team) && draft.team.length > 0)),
    team: Boolean((Array.isArray(draft?.team) && draft.team.length > 0) || (Array.isArray(draft?.projectManager) && draft.projectManager.length > 0)),
    email: Boolean(draft?.email && String(draft.email).trim()),
    phone: Boolean(draft?.phone && String(draft.phone).trim()),
    industry: Boolean(draft?.industry && String(draft.industry).trim()),
    gst: Boolean(draft?.gst && String(draft.gst).trim()),
    pan: Boolean(draft?.pan && String(draft.pan).trim()),
    website: Boolean(draft?.website && String(draft.website).trim()),
    address: Boolean(draft?.address && String(draft.address).trim()),
    state: Boolean(draft?.state && String(draft.state).trim()),
    country: Boolean(draft?.country && String(draft.country).trim()),
    pincode: Boolean(draft?.pincode && String(draft.pincode).trim()),
    notes: Boolean(draft?.notes && String(draft.notes).trim()),
    description_client: Boolean(draft?.description && String(draft.description).trim()),
  };

  const initialValues = {
    title: draft?.title ?? null,
    description: draft?.description ?? null,
    dueDateTime: draft?.dueDateTime ?? null,
    dueDate: draft?.dueDate ?? draft?.dueDateTime ?? null,
    projectId: draft?.projectId ?? null,
    projectName: draft?.projectName ?? null,
    priority: draft?.priority ?? null,
    status: draft?.status ?? null,
    reminder: draft?.reminder ?? null,
    reminderOption: draft?.reminderOption ?? null,
    repeatIntervalMinutes: draft?.repeatIntervalMinutes ?? null,
    minutesBeforeDue: draft?.minutesBeforeDue ?? null,
    assigneeId: draft?.assigneeId ?? null,
    assignee: draft?.assignee ?? draft?.assigneeName ?? null,
    assigneeName: draft?.assigneeName ?? draft?.assignee ?? null,
  };

  const notices = [];
  let candidates = [];

  // Determine user scope
  const scope = await scopeInfoFn(req, deps);
  const uRole = String(req?.user?.role || req?.user?.userRole || '').toLowerCase();
  const cRole = String(req?.user?.companyRole || '').toLowerCase();
  const isPrivilegedUser = Boolean(
    req?.user?.isSuperAdmin ||
    req?.user?.superAdmin ||
    uRole.includes('admin') ||
    uRole.includes('owner') ||
    cRole.includes('admin') ||
    cRole.includes('owner') ||
    req?.user?.permissions?.includes?.('admin-task-create')
  );
  // Retrieve accessible projects tenant-safely
  const accessibleProjects = Array.isArray(deps.accessibleProjects)
    ? deps.accessibleProjects
    : await getAccessibleProjects(req, deps);
  deps.accessibleProjects = accessibleProjects;

  let sidebarMenuItems = Array.isArray(deps.sidebarMenuItems) ? deps.sidebarMenuItems : [];
  if (sidebarMenuItems.length === 0 && (deps.SidebarConfig || (mongoose && mongoose.connection && mongoose.connection.readyState === 1))) {
    try {
      const SCModel = deps.SidebarConfig || (mongoose && mongoose.models && mongoose.models.SidebarConfig) || SidebarConfig;
      const roleId = req?.user?.jobRole?._id || req?.user?.jobRole || req?.user?.role;
      const compId = req?.user?.company?._id || req?.user?.company || req?.user?.companyId;
      if (SCModel && compId && roleId) {
        const scDoc = await SCModel.findOne({ companyId: compId, role: String(roleId) }).lean();
        if (scDoc && Array.isArray(scDoc.menuItems)) {
          sidebarMenuItems = scDoc.menuItems;
        }
      }
    } catch (err) {
      // Ignore DB lookup error
    }
  }
  deps.sidebarMenuItems = sidebarMenuItems;

  const userAllowedIntents = resolveUserAllowedIntents(req?.user, scope, {
    ...deps,
    accessibleProjects,
    sidebarMenuItems,
    allowedIntents: deps.allowedIntents || req?.body?.allowedIntents
  });
  const canAssignOthers = Boolean(
    isPrivilegedUser ||
    scope.isOwner ||
    userAllowedIntents.includes('task_assigned_user')
  );

  const companyId = req?.user?.company?._id || req?.user?.company || req?.user?.companyId;
  const rawCompanyCode = req?.user?.companyCode || req?.user?.company?.companyCode || '';
  const cleanCompanyCode = rawCompanyCode;
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = (baseCode && baseCode !== rawCompanyCode)
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  // Determine the active field that was asked on the previous turn
  // Ensure companyUsers, services, clientPlans, and accessibleClients are populated
  const isDbConnected = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
  let companyUsers = Array.isArray(deps.companyUsers) ? deps.companyUsers : (Array.isArray(scope?.users) ? scope.users : []);
  let companyServices = Array.isArray(deps.services) ? deps.services : (Array.isArray(scope?.services) ? scope.services : []);
  let companyPlans = Array.isArray(deps.clientPlans) ? deps.clientPlans : (Array.isArray(scope?.clientPlans) ? scope.clientPlans : []);
  let accessibleClients = Array.isArray(deps.accessibleClients) ? deps.accessibleClients : [];

  await Promise.all([
    (async () => {
      if ((!companyUsers || companyUsers.length === 0) && (deps.User || isDbConnected)) {
        const UModel = deps.User || (mongoose && mongoose.models && mongoose.models.User) || User;
        if (UModel && typeof UModel.find === 'function') {
          try {
            const uQuery = {
              isActive: { $ne: false },
              companyRole: { $not: /^client$/i },
              role: { $not: /^client$/i },
              ...(companyCodeFilter ? { companyCode: companyCodeFilter } : (cleanCompanyCode ? { companyCode: cleanCompanyCode } : {}))
            };
            companyUsers = await UModel.find(uQuery)
              .select('name department role jobRole companyRole email company companyCode')
              .populate('department', 'name')
              .lean();
          } catch (err) {
            console.warn('[taskAgentService] Error loading companyUsers:', err);
          }
        }
      }
    })(),
    (async () => {
      if ((!companyServices || companyServices.length === 0) && (deps.Service || isDbConnected)) {
        const SModel = deps.Service || (mongoose && mongoose.models && mongoose.models.Service);
        if (SModel && typeof SModel.find === 'function') {
          try {
            const sQuery = cleanCompanyCode ? { companyCode: cleanCompanyCode } : {};
            const docs = await SModel.find(sQuery).select('servicename name').lean();
            companyServices = docs.map(d => d.servicename || d.name).filter(Boolean);
          } catch (err) {
            console.warn('[taskAgentService] Error loading services:', err);
          }
        }
      }
    })(),
    (async () => {
      if ((!companyPlans || companyPlans.length === 0) && (deps.ClientPlan || isDbConnected)) {
        const PModel = deps.ClientPlan || (mongoose && mongoose.models && mongoose.models.ClientPlan) || ClientPlan;
        if (PModel && typeof PModel.find === 'function') {
          try {
            const pQuery = {
              isActive: { $ne: false },
              ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
            };
            companyPlans = await PModel.find(pQuery).lean();
          } catch (err) {
            console.warn('[taskAgentService] Error loading clientPlans:', err);
          }
        }
      }
    })(),
    (async () => {
      if ((!accessibleClients || accessibleClients.length === 0) && (deps.Client || isDbConnected)) {
        const CModel = deps.Client || (mongoose && mongoose.models && mongoose.models.Client) || Client;
        if (CModel && typeof CModel.find === 'function') {
          try {
            const cQuery = cleanCompanyCode ? { companyCode: cleanCompanyCode } : {};
            accessibleClients = await CModel.find(cQuery)
              .select('client company services activeClientPlan projectManager status email phone progress')
              .populate('activeClientPlan', 'name price services')
              .lean();
          } catch (err) {
            console.warn('[taskAgentService] Error loading accessibleClients:', err);
          }
        }
      }
    })()
  ]);

  if (Array.isArray(companyUsers)) {
    companyUsers = companyUsers.filter(u => {
      const cRole = String(u.companyRole || u.role || '').toLowerCase();
      const isClient = Boolean(u.isClient || cRole === 'client' || (u.email && u.email.includes('client')));
      return !isClient;
    });
  }
  deps.companyUsers = companyUsers;

  if (!companyServices || companyServices.length === 0) {
    companyServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design'];
  }
  deps.services = companyServices;
  deps.clientPlans = companyPlans;
  deps.accessibleClients = accessibleClients;

  let clientTasks = Array.isArray(deps.clientTasks) ? deps.clientTasks : [];
  if ((!clientTasks || clientTasks.length === 0) && (deps.ClientTask || isDbConnected)) {
    const CTModel = deps.ClientTask || (mongoose && mongoose.models && mongoose.models.ClientTask) || ClientTask;
    if (CTModel && typeof CTModel.find === 'function') {
      try {
        const clientIds = (accessibleClients || []).map(c => c._id || c.id).filter(Boolean);
        const ctQuery = clientIds.length > 0 ? { clientId: { $in: clientIds } } : {};
        clientTasks = await CTModel.find(ctQuery)
          .select('clientId service name status assignee dueDate priority')
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(100)
          .lean();
      } catch (err) {
        console.warn('[taskAgentService] Error loading clientTasks:', err);
      }
    }
  }
  deps.clientTasks = clientTasks;

async function resolveProjectForAction(action, req, deps, currentDraft) {
  const isDbReady = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
  const ProjectModel = deps.Project || DefaultProjectModel || (mongoose?.models?.Project) || (isDbReady ? require('../../HR-CDS/models/Project').Project : null);
  const targetId = action?.projectId || currentDraft?.lastProjectId || currentDraft?.projectId;
  const targetName = action?.projectName || currentDraft?.lastProjectName;

  let projectDoc = null;
  const accessibleList = deps.accessibleProjects || deps.projects || [];
  if (targetId) {
    projectDoc = accessibleList.find(p => String(p._id || p.id) === String(targetId));
  }
  if (!projectDoc && targetName) {
    projectDoc = accessibleList.find(p => (p.projectName || p.name || '').toLowerCase() === targetName.toLowerCase());
  }

  if (!projectDoc && isDbReady && ProjectModel) {
    try {
      if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
        projectDoc = await ProjectModel.findById(targetId)
          .populate('users', '_id name email role jobRole companyRole profileImage')
          .populate('tasks.assignedTo', '_id name email role jobRole companyRole')
          .populate('tasks.assignedUsers', '_id name email role jobRole companyRole')
          .lean();
      } else if (targetName) {
        projectDoc = await ProjectModel.findOne({
          projectName: { $regex: new RegExp(`^${escapeRegex(targetName)}$`, 'i') }
        })
          .populate('users', '_id name email role jobRole companyRole profileImage')
          .populate('tasks.assignedTo', '_id name email role jobRole companyRole')
          .populate('tasks.assignedUsers', '_id name email role jobRole companyRole')
          .lean();
      }
    } catch (e) {
      console.warn('[taskAgentService] Error in resolveProjectForAction:', e);
    }
  }

  if (!projectDoc && accessibleList.length === 1) {
    projectDoc = accessibleList[0];
  }

  return projectDoc;
}

const lastAskedField = currentDraft.asked.length > 0
    ? currentDraft.asked[currentDraft.asked.length - 1]
    : null;

  // -------------------------------------------------------------
  // STEP 1: Handle deterministic action or pick (NO LLM, FREE)
  // -------------------------------------------------------------
  let actionHandled = false;
  let wantsEditPrompt = false;
  let ackPrefix = currentDraft.lastTaskNotice || '';
  currentDraft.lastTaskNotice = null;
  let speechPrefix = '';

  // Direct project pick from pick or action
  const targetPickedProjectId = (action?.type === 'pickProject' ? (action.projectId || action.value) : null) ||
    action?.pickProject?.projectId ||
    pick?.projectId ||
    pick?.pickProject?.projectId ||
    (action?.type === 'set' && action?.field === 'projectId' ? action.value : null);

  if (targetPickedProjectId) {
    actionHandled = true;
    const matchedProj = accessibleProjects.find((p) => idsEqual(p._id, targetPickedProjectId));
    if (matchedProj) {
      if (currentDraft.intent !== 'task_project') {
        const migration = migrateDraftBetweenIntents(currentDraft.intent, 'task_project', currentDraft);
        Object.assign(currentDraft, migration.newDraft);
      }
      currentDraft.projectId = String(matchedProj._id);
      currentDraft.projectName = matchedProj.projectName;
      currentDraft.project = matchedProj.projectName;
      currentDraft.projectStartDate = matchedProj.startDate;
      currentDraft.projectIdSuffix = String(matchedProj._id).slice(-6);
      currentDraft.showDistinguishing = Boolean(
        currentDraft.showDistinguishing || requiresProjectDistinguishing(matchedProj, accessibleProjects)
      );
      currentDraft.intent = 'task_project';
      currentDraft.taskFor = 'project';
      if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
      currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
    } else {
      notices.push('Selected project aapke access scope mein nahi hai.');
    }
  }

  if (action && typeof action === 'object' && action.type) {
    actionHandled = true;
    switch (action.type) {
      case 'set_intent': {
        if (action.intent === 'view_project') {
          action.type = 'view_project';
          // Fall through to view_project handler below
        } else {
          const allowedIntents = resolveUserAllowedIntents(req?.user, scope, { ...deps, allowedIntents: action.allowedIntents || req?.body?.allowedIntents });
          if (!allowedIntents.includes(action.intent)) {
            const denial = getPermissionDeniedReply(action.intent, allowedIntents, req?.user);
            const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents });
            return {
              success: true,
              status: 'open',
              field: 'welcome',
              reply: denial.reply,
              speech: denial.speech,
              speakText: denial.speakText,
              speakTextHi: denial.speakTextHi,
              draft: null,
              chips: welcomeChips,
              candidates: [],
              notices: [],
              canAssignOthers
            };
          }
          currentDraft.intent = action.intent;
          if (action.intent === 'self_task') {
            currentDraft.taskFor = 'self';
            currentDraft.wantsOthers = false;
          }
          if (action.intent === 'task_assigned_user') {
            currentDraft.taskFor = 'others';
            currentDraft.wantsOthers = true;
            currentDraft.skipped = (currentDraft.skipped || []).filter(f => f !== 'assignee');
          }
          if (action.intent === 'task_project') currentDraft.taskFor = 'project';
          if (action.intent === 'create_client_task') {
            Object.keys(currentDraft).forEach(k => {
              if (k !== 'history' && k !== '_id') delete currentDraft[k];
            });
            currentDraft.intent = 'create_client_task';
            currentDraft.asked = [];
            currentDraft.skipped = [];
            currentDraft.askCounts = {};
            if (action.client) {
              currentDraft.client = action.client;
              currentDraft.asked.push('client');
            }
            if (action.clientId) currentDraft.clientId = action.clientId;
            if (Array.isArray(action.clientServices)) currentDraft.clientServices = action.clientServices;
            if (action.service) {
              currentDraft.service = action.service;
              currentDraft.asked.push('service');
            }
          }
          if (action.intent === 'create_client') {
            Object.keys(currentDraft).forEach(k => {
              if (k !== 'history' && k !== '_id') delete currentDraft[k];
            });
            currentDraft.intent = 'create_client';
            currentDraft.asked = [];
            currentDraft.skipped = [];
            currentDraft.askCounts = {};
          }
          if (action.intent === 'create_client_plan') {
            Object.keys(currentDraft).forEach(k => {
              if (k !== 'history' && k !== '_id') delete currentDraft[k];
            });
            currentDraft.intent = 'create_client_plan';
            currentDraft.asked = [];
            currentDraft.skipped = [];
            currentDraft.askCounts = {};
          }
          break;
        }
      }
      case 'view_project':
      case 'show_project_details': {
        actionHandled = true;
        const projectDoc = await resolveProjectForAction(action, req, deps, currentDraft);
        const pUserId = req?.user?._id || req?.user?.id;
        if (!projectDoc) {
          const notFoundMsg = isEn ? "Could not find the project details." : "Project ki details nahi mil saki.";
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: notFoundMsg,
            speech: notFoundMsg,
            speakText: notFoundMsg,
            draft: currentDraft,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }
        if (!hasProjectAccess(projectDoc, pUserId, req?.user?.role, req?.user)) {
          const pName = projectDoc.projectName || 'Project';
          const denial = isEn
            ? `You do not have access to the "${pName}" project in your account.`
            : `Aapke account mein "${pName}" project ka access nahi hai, isliye main iski details nahi dikha sakta.`;
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: denial,
            speech: denial,
            speakText: denial,
            draft: null,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }

        currentDraft.lastProjectId = String(projectDoc._id || projectDoc.id);
        currentDraft.lastProjectName = projectDoc.projectName || projectDoc.name;

        const rep = formatProjectDetails(projectDoc, req, isEn);
        const pName = projectDoc.projectName || projectDoc.name || 'Project';
        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: isEn ? `Project ${pName} details.` : `Project ${pName} ki details.`,
          speakText: rep,
          speakTextHi: isEn ? null : `Project ${pName} ki details.`,
          draft: currentDraft,
          chips: [
            { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: 'Team members list', action: { type: 'view_project_members', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: `${pName} mein task banana`, action: { type: 'pickProject', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: 'Main menu', action: { type: 'reset' } }
          ],
          candidates: [],
          notices: []
        };
      }
      case 'view_project_tasks': {
        actionHandled = true;
        const projectDoc = await resolveProjectForAction(action, req, deps, currentDraft);
        const pUserId = req?.user?._id || req?.user?.id;
        if (!projectDoc) {
          const notFoundMsg = isEn ? "Could not find the project tasks." : "Project ke tasks nahi mil sake.";
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: notFoundMsg,
            speech: notFoundMsg,
            speakText: notFoundMsg,
            draft: currentDraft,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }
        if (!hasProjectAccess(projectDoc, pUserId, req?.user?.role, req?.user)) {
          const pName = projectDoc.projectName || 'Project';
          const denial = isEn
            ? `You do not have access to the "${pName}" project tasks in your account.`
            : `Aapke account mein "${pName}" project ke tasks ka access nahi hai.`;
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: denial,
            speech: denial,
            speakText: denial,
            draft: null,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }

        currentDraft.lastProjectId = String(projectDoc._id || projectDoc.id);
        currentDraft.lastProjectName = projectDoc.projectName || projectDoc.name;

        const rep = formatProjectTasksList(projectDoc, req, isEn);
        const pTasks = Array.isArray(projectDoc.tasks) ? projectDoc.tasks : [];
        const chips = [];
        if (pTasks[0]) {
          chips.push({
            label: `${pTasks[0].title || 'Task'} status update`,
            action: {
              type: 'update_project_task_status',
              projectId: String(projectDoc._id || projectDoc.id),
              taskId: String(pTasks[0]._id || pTasks[0].id),
              taskTitle: pTasks[0].title || 'Task'
            }
          });
        }
        chips.push(
          { label: '+ Task add karein', action: { type: 'pickProject', projectId: String(projectDoc._id || projectDoc.id) } },
          { label: 'Project details', action: { type: 'view_project', projectId: String(projectDoc._id || projectDoc.id) } },
          { label: 'Team members list', action: { type: 'view_project_members', projectId: String(projectDoc._id || projectDoc.id) } },
          { label: 'Main menu', action: { type: 'reset' } }
        );

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: isEn ? `Project tasks list.` : `Project ke tasks ki list.`,
          speakText: rep,
          speakTextHi: isEn ? null : `Project ke tasks ki list.`,
          draft: currentDraft,
          chips,
          candidates: [],
          notices: []
        };
      }
      case 'view_project_members': {
        actionHandled = true;
        const projectDoc = await resolveProjectForAction(action, req, deps, currentDraft);
        const pUserId = req?.user?._id || req?.user?.id;
        if (!projectDoc) {
          const notFoundMsg = isEn ? "Could not find the project team members." : "Project ke team members nahi mil sake.";
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: notFoundMsg,
            speech: notFoundMsg,
            speakText: notFoundMsg,
            draft: currentDraft,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }
        if (!hasProjectAccess(projectDoc, pUserId, req?.user?.role, req?.user)) {
          const pName = projectDoc.projectName || 'Project';
          const denial = isEn
            ? `You do not have access to view team members of "${pName}".`
            : `Aapke account mein "${pName}" project ke team members dekhne ka access nahi hai.`;
          return {
            success: true,
            status: 'open',
            field: 'welcome',
            reply: denial,
            speech: denial,
            speakText: denial,
            draft: null,
            chips: [{ label: 'Main menu', action: { type: 'reset' } }],
            candidates: [],
            notices: []
          };
        }

        currentDraft.lastProjectId = String(projectDoc._id || projectDoc.id);
        currentDraft.lastProjectName = projectDoc.projectName || projectDoc.name;

        const rep = formatProjectTeamMembers(projectDoc, req, isEn);
        const pName = projectDoc.projectName || projectDoc.name || 'Project';
        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: isEn ? `Project team members list.` : `Project ke team members ki list.`,
          speakText: rep,
          speakTextHi: isEn ? null : `Project ke team members ki list.`,
          draft: currentDraft,
          chips: [
            { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: 'Project details', action: { type: 'view_project', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: `${pName} mein task banana`, action: { type: 'pickProject', projectId: String(projectDoc._id || projectDoc.id) } },
            { label: 'Main menu', action: { type: 'reset' } }
          ],
          candidates: [],
          notices: []
        };
      }
      case 'update_project_task_status': {
        actionHandled = true;
        const targetProjectId = action.projectId || currentDraft.lastProjectId;
        const targetTaskId = action.taskId;
        const taskTitle = action.taskTitle || 'Task';
        const targetStatus = action.targetStatus;

        // If targetStatus not yet selected, prompt with status choice chips
        if (!targetStatus) {
          const promptMsg = isEn
            ? `Select the new status for task **"${taskTitle}"**:`
            : `Task **"${taskTitle}"** ke liye naya status chuniye:`;
          return {
            success: true,
            status: 'needs_input',
            field: 'status_select',
            reply: promptMsg,
            speech: promptMsg,
            speakText: promptMsg,
            draft: currentDraft,
            chips: [
              { label: 'Pending', action: { type: 'update_project_task_status', projectId: targetProjectId, taskId: targetTaskId, taskTitle, targetStatus: 'pending' } },
              { label: 'In Progress', action: { type: 'update_project_task_status', projectId: targetProjectId, taskId: targetTaskId, taskTitle, targetStatus: 'in progress' } },
              { label: 'Completed', action: { type: 'update_project_task_status', projectId: targetProjectId, taskId: targetTaskId, taskTitle, targetStatus: 'completed' } },
              { label: 'On Hold', action: { type: 'update_project_task_status', projectId: targetProjectId, taskId: targetTaskId, taskTitle, targetStatus: 'on hold' } },
              { label: 'Cancel', action: { type: 'view_project_tasks', projectId: targetProjectId } }
            ],
            candidates: [],
            notices: []
          };
        }

        // Save status update to database
        const isDbReady = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
        const ProjectModel = deps.Project || DefaultProjectModel || (mongoose?.models?.Project) || (isDbReady ? require('../../HR-CDS/models/Project').Project : null);
        const pUserId = req?.user?._id || req?.user?.id;

        let updatedTaskItem = null;
        let projectName = '';

        if (isDbReady && ProjectModel && targetProjectId) {
          try {
            const pDoc = await ProjectModel.findById(targetProjectId);
            if (pDoc) {
              projectName = pDoc.projectName;
              if (!hasProjectAccess(pDoc, pUserId, req?.user?.role, req?.user)) {
                const denial = isEn ? "You do not have access to update tasks in this project." : "Aapke paas is project ke tasks update karne ka access nahi hai.";
                return {
                  success: false,
                  status: 'open',
                  field: 'welcome',
                  reply: denial,
                  speech: denial,
                  speakText: denial,
                  draft: currentDraft,
                  chips: [{ label: 'Main menu', action: { type: 'reset' } }]
                };
              }
              const tItem = pDoc.tasks?.id ? pDoc.tasks.id(targetTaskId) : pDoc.tasks?.find(t => String(t._id || t.id) === String(targetTaskId));
              if (tItem) {
                const normStatus = targetStatus.toLowerCase();
                const nextProjStatus = normStatus === 'in-progress' ? 'in progress' : (normStatus === 'onhold' ? 'on hold' : normStatus);
                const now = new Date();
                const updateFields = {
                  "tasks.$.status": nextProjStatus,
                  "tasks.$.updatedAt": now,
                  "tasks.$.statusChangedAt": now
                };
                tItem.status = nextProjStatus;
                if (nextProjStatus === 'completed') {
                  updateFields["tasks.$.completionDate"] = now;
                  tItem.completionDate = now;
                } else if (tItem.completionDate) {
                  updateFields["tasks.$.completionDate"] = null;
                  tItem.completionDate = null;
                }

                const activityLog = {
                  type: 'status_change',
                  description: `Status changed to ${nextProjStatus} via CIIS AI`,
                  oldValue: tItem.status,
                  newValue: nextProjStatus,
                  performedBy: pUserId,
                  performedByName: req?.user?.name || 'User',
                  remark: action.remark || "Status updated via CIIS AI",
                  timestamp: now
                };

                const statusRemarkDoc = action.remark ? {
                  _id: new mongoose.Types.ObjectId(),
                  mentions: [],
                  text: action.remark,
                  createdBy: pUserId,
                  userName: req?.user?.name || 'User',
                  createdAt: now
                } : null;

                if (!Array.isArray(tItem.activityLogs)) tItem.activityLogs = [];
                tItem.activityLogs.push(activityLog);
                if (statusRemarkDoc) {
                  if (!Array.isArray(tItem.remarks)) tItem.remarks = [];
                  tItem.remarks.push(statusRemarkDoc);
                }

                await ProjectModel.updateOne(
                  { _id: pDoc._id, "tasks._id": tItem._id },
                  {
                    $set: updateFields,
                    $push: {
                      "tasks.$.activityLogs": activityLog,
                      ...(statusRemarkDoc ? { "tasks.$.remarks": statusRemarkDoc } : {})
                    }
                  }
                );

                if (typeof pDoc.markModified === 'function') pDoc.markModified('tasks');
                try {
                  await pDoc.save();
                } catch (saveErr) {}
                updatedTaskItem = tItem;
              }
            }
          } catch (e) {
            console.warn('[taskAgentService] Error updating project task status:', e);
          }
        }

        // Also update memory mock if in deps/context
        const memProjects = context.accessibleProjects || deps.accessibleProjects || deps.projects || [];
        const memProj = memProjects.find(p => String(p._id || p.id) === String(targetProjectId));
        if (memProj && Array.isArray(memProj.tasks)) {
          const memTask = memProj.tasks.find(t => String(t._id || t.id) === String(targetTaskId));
          if (memTask) {
            memTask.status = targetStatus.toLowerCase();
            if (!updatedTaskItem) updatedTaskItem = memTask;
          }
        }

        const rep = isEn
          ? `Project task **"${taskTitle}"** status has been updated to **${targetStatus}**! ✅`
          : `Project task **"${taskTitle}"** ka status **${targetStatus}** safaltapoorvak update kar diya gaya hai! ✅`;

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: rep,
          speakText: rep,
          draft: currentDraft,
          taskUpdated: true,
          updatedTaskId: String(targetTaskId),
          updatedTask: updatedTaskItem,
          chips: [
            { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: targetProjectId } },
            { label: 'Project details', action: { type: 'view_project', projectId: targetProjectId } },
            { label: 'Main menu', action: { type: 'reset' } }
          ],
          candidates: [],
          notices: []
        };
      }
      case 'set_client_task_client': {
        actionHandled = true;
        currentDraft.intent = 'create_client_task';
        currentDraft.client = action.client || action.name || null;
        currentDraft.clientId = action.clientId || action.id || null;
        if (Array.isArray(action.clientServices)) currentDraft.clientServices = action.clientServices;
        if (!currentDraft.asked.includes('client')) currentDraft.asked.push('client');
        break;
      }
      case 'set_client_task_service': {
        actionHandled = true;
        currentDraft.intent = 'create_client_task';
        currentDraft.service = action.service || action.value || null;
        if (!currentDraft.asked.includes('service')) currentDraft.asked.push('service');
        break;
      }
      case 'set_client_task_assignee': {
        actionHandled = true;
        currentDraft.assignee = action.assignee || action.name || '';
        currentDraft.assigneeId = action.assigneeId || action.userId || null;
        if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
        break;
      }
      case 'skip_client_task_assignee': {
        actionHandled = true;
        currentDraft.assignee = '';
        currentDraft.assigneeId = null;
        if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
        break;
      }
      case 'skip_client_task_description': {
        actionHandled = true;
        currentDraft.description = '';
        if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
        break;
      }
      case 'set_client_task_reminder': {
        actionHandled = true;
        currentDraft.reminder = Boolean(action.reminder);
        currentDraft.reminderOption = action.reminderOption || 'off';
        currentDraft.reminderSettings = {
          enabled: Boolean(action.reminder),
          reminderOption: action.reminderOption || 'off',
          repeatIntervalMinutes: action.repeatIntervalMinutes || null,
          options: action.reminderOption ? [action.reminderOption] : [],
        };
        if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
        break;
      }
      case 'skip_client_task_checkpoints': {
        actionHandled = true;
        currentDraft.checkpoints = [];
        currentDraft.checkpointsAsked = true;
        if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
        break;
      }
      case 'set_client_task_checkpoints': {
        actionHandled = true;
        const cpList = Array.isArray(action.checkpoints) ? action.checkpoints : (action.value ? [action.value] : []);
        currentDraft.checkpoints = cpList.map(c => typeof c === 'string' ? { title: c, completed: false } : c);
        currentDraft.checkpointsAsked = true;
        if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
        break;
      }
      case 'complete_task':
      case 'update_task_select': {
        actionHandled = true;
        const targetTaskId = action.taskId;
        const targetStatus = action.targetStatus || (action.type === 'complete_task' ? 'completed' : null);
        const targetPriority = action.targetPriority || null;
        const taskTitle = action.taskTitle || 'Task';

        const isDbReady = Boolean(mongoose && mongoose.connection && mongoose.connection.readyState === 1);
        const isValidObjectId = (id) => Boolean(id && mongoose && mongoose.Types && mongoose.Types.ObjectId && mongoose.Types.ObjectId.isValid(id));
        const ClientTaskModel = deps.ClientTask || (mongoose && mongoose.models && mongoose.models.ClientTask) || (isDbReady ? require('../../HR-CDS/models/ClientTask') : null);
        const TaskModel = deps.Task || (mongoose && mongoose.models && mongoose.models.Task) || (isDbReady ? require('../../HR-CDS/models/Task') : null);

        let didUpdate = false;
        if (Array.isArray(deps.clientTasks)) {
          const ct = deps.clientTasks.find(t => String(t._id || t.id) === String(targetTaskId));
          if (ct) {
            if (targetStatus) { ct.status = targetStatus; if (targetStatus === 'completed') ct.completed = true; }
            if (targetPriority) ct.priority = targetPriority;
            didUpdate = true;
          }
        }
        if (!didUpdate && Array.isArray(deps.tasks)) {
          const tt = deps.tasks.find(t => String(t._id || t.id) === String(targetTaskId));
          if (tt) {
            applyTaskStatusAndPriority(tt, targetStatus, targetPriority, req?.user?._id || req?.user?.id);
            didUpdate = true;
          }
        }
        if (!didUpdate && isDbReady && isValidObjectId(targetTaskId)) {
          if (ClientTaskModel) {
            try {
              const ct = await ClientTaskModel.findById(targetTaskId);
              if (ct) {
                if (targetStatus) { ct.status = targetStatus; if (targetStatus === 'completed') { ct.completed = true; ct.completedAt = new Date(); } }
                if (targetPriority) ct.priority = targetPriority;
                await ct.save();
                didUpdate = true;
              }
            } catch {}
          }
          if (!didUpdate && TaskModel) {
            try {
              const tt = await TaskModel.findById(targetTaskId);
              if (tt) {
                applyTaskStatusAndPriority(tt, targetStatus, targetPriority, req?.user?._id || req?.user?.id);
                await tt.save();
                didUpdate = true;
              }
            } catch {}
          }
        }

        const rep = isEn
          ? `Task **"${taskTitle}"** has been updated successfully! ✅`
          : `Task **"${taskTitle}"** safaltapoorvak update kar diya gaya hai! ✅`;

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: rep,
          speech: rep,
          speakText: rep,
          speakTextHi: rep,
          draft: null,
          taskUpdated: true,
          updatedTaskId: String(targetTaskId),
          chips: [
            { label: 'Tasks list dekhein', action: { type: 'show_tasks' } },
            { label: 'Main menu', action: { type: 'reset' } }
          ],
          candidates: [],
          notices: []
        };
      }
      case 'reset': {
        actionHandled = true;
        Object.keys(currentDraft).forEach(k => {
          if (k !== 'history' && k !== '_id') delete currentDraft[k];
        });
        currentDraft.intent = null;
        currentDraft.asked = [];
        currentDraft.skipped = [];
        currentDraft.askCounts = {};

        const allowedIntents = resolveUserAllowedIntents(req?.user, scope, { ...deps, allowedIntents: action.allowedIntents || req?.body?.allowedIntents });
        const welcomeMsg = getWelcomeMessage(req?.user, now);
        const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents });
        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: welcomeMsg.reply,
          speech: welcomeMsg.speech,
          speakText: welcomeMsg.speakText,
          speakTextHi: welcomeMsg.speakTextHi,
          draft: null,
          chips: welcomeChips,
          candidates: [],
          notices: [],
          canAssignOthers,
          meta: { model: modelName },
        };
      }
            case 'set_team_members': {
        actionHandled = true;
        const rawMembers = Array.isArray(action.members) ? action.members : [];
        let compUsers = deps.companyUsers || [];
        if ((!compUsers || compUsers.length === 0) && mongoose?.connection?.readyState === 1 && (deps.User || mongoose.models.User)) {
          try {
            compUsers = await (deps.User || mongoose.models.User).find({
              ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
            }).select('name email role department').lean();
          } catch {}
        }
        const addedList = [];
        rawMembers.forEach(m => {
          const mId = typeof m === 'object' ? String(m.id || m._id || m.userId || '') : '';
          const mName = typeof m === 'object' ? (m.name || m.label || '') : String(m);
          const matchedUser = (compUsers || []).find(u =>
            (mId && String(u._id || u.id) === mId) ||
            (mName && u.name && u.name.toLowerCase() === mName.toLowerCase())
          );
          const finalName = matchedUser?.name || mName;
          const finalId = String(matchedUser?._id || matchedUser?.id || mId || '');
          if (finalName) {
            addedList.push({
              id: finalId,
              name: finalName,
              label: formatMemberChipLabel(matchedUser || { name: finalName }),
              department: getCleanDepartment(matchedUser),
            });
          }
        });

        if (currentDraft.intent === 'create_client') {
          currentDraft.projectManager = addedList;
          currentDraft.team = addedList.map(m => m.id);
          currentDraft.teamDone = true;
          if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
          if (!currentDraft.asked.includes('team')) currentDraft.asked.push('team');
          notices.push(addedList.map(m => m.name).join(', ') + ' add ho gaye.');
        } else if (currentDraft.intent === 'create_project') {
          currentDraft.members = addedList;
          currentDraft.membersDone = true;
          if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
          notices.push(addedList.map(m => m.name).join(', ') + ' add ho gaye.');
        } else if (currentDraft.intent === 'task_assigned_user') {
          currentDraft.assignees = addedList;
          currentDraft.assignedUsers = addedList.map(m => m.id).filter(Boolean);
          if (addedList.length > 0) {
            currentDraft.assigneeId = addedList[0].id;
            currentDraft.assigneeName = addedList.map(m => m.name).join(', ');
            currentDraft.assigneeLabel = addedList.map(m => m.name).join(', ');
          }
          currentDraft.assigneeDone = true;
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
          notices.push(addedList.map(m => m.name).join(', ') + ' add ho gaye.');
        }
        break;
      }
      case 'set_client_services': {
        actionHandled = true;
        const rawServices = Array.isArray(action.services) ? action.services : [];
        let compServices = deps.services || scope?.services || [];
        if (!compServices || compServices.length === 0) {
          if (mongoose?.connection?.readyState === 1 && (deps.Service || mongoose.models.Service)) {
            try {
              const docs = await (deps.Service || mongoose.models.Service).find({
                ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
              }).select('servicename').lean();
              compServices = docs.map(d => d.servicename);
            } catch {}
          }
        }
        if (!compServices || compServices.length === 0) {
          compServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'];
        }
        const matchedServices = [];
        rawServices.forEach(raw => {
          const rawStr = String(raw).trim();
          const matched = compServices.find(cs => {
            const csName = typeof cs === 'string' ? cs : (cs.servicename || cs.name || '');
            return csName.toLowerCase() === rawStr.toLowerCase();
          });
          if (matched) {
            const finalName = typeof matched === 'string' ? matched : (matched.servicename || matched.name);
            matchedServices.push(finalName);
          } else if (rawStr) {
            matchedServices.push(rawStr);
          }
        });
        currentDraft.services = Array.from(new Set([...(currentDraft.services || []), ...matchedServices]));
        currentDraft.servicesDone = true;
        if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
        if (matchedServices.length > 0) {
          notices.push('Services add ho gayi: ' + matchedServices.join(', ') + '.');
        }
        break;
      }
      case 'add_member': {
        actionHandled = true;
        const memberName = action.name || action.value;
        const memberId = action.userId || action.id || action.assigneeId;
        const userPool = (Array.isArray(companyUsers) && companyUsers.length > 0) ? companyUsers : (deps.companyUsers || []);
        const matchedUser = userPool.find(u =>
          (memberId && String(u._id || u.id) === String(memberId)) ||
          (memberName && u.name && u.name.toLowerCase() === String(memberName).toLowerCase())
        );
        const finalName = matchedUser?.name || memberName;
        const finalId = String(matchedUser?._id || matchedUser?.id || memberId || '');

        if (currentDraft.intent === 'create_client') {
          if (!Array.isArray(currentDraft.projectManager)) currentDraft.projectManager = [];
          const exists = currentDraft.projectManager.some(m =>
            (finalId && String(m.id || m._id || m) === finalId) ||
            (finalName && m.name && m.name.toLowerCase() === finalName.toLowerCase())
          );
          if (!exists) {
            currentDraft.projectManager.push({
              id: finalId,
              name: finalName,
              label: formatMemberChipLabel(matchedUser || { name: finalName }),
              department: getCleanDepartment(matchedUser),
            });
            currentDraft.team = currentDraft.projectManager.map(m => m.id);
          }
          currentDraft.teamDone = true;
          if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
          if (!currentDraft.asked.includes('team')) currentDraft.asked.push('team');
        } else if (currentDraft.intent === 'task_assigned_user') {
          if (!Array.isArray(currentDraft.assignees)) currentDraft.assignees = [];
          const exists = currentDraft.assignees.some(m =>
            (finalId && String(m.id || m._id || m) === finalId) ||
            (finalName && m.name && m.name.toLowerCase() === finalName.toLowerCase())
          );
          if (!exists) {
            currentDraft.assignees.push({
              id: finalId,
              name: finalName,
              label: formatMemberChipLabel(matchedUser || { name: finalName }),
              department: getCleanDepartment(matchedUser),
            });
            currentDraft.assignedUsers = currentDraft.assignees.map(m => m.id);
            currentDraft.assigneeId = currentDraft.assignees[0].id;
            currentDraft.assigneeName = currentDraft.assignees.map(m => m.name).join(', ');
            currentDraft.assigneeLabel = currentDraft.assignees.map(m => m.name).join(', ');
            if (!Array.isArray(currentDraft.assigneeLedger)) currentDraft.assigneeLedger = [];
            currentDraft.assigneeLedger.push({
              rawName: finalName,
              displayName: finalName,
              userId: finalId,
              status: 'resolved',
              user: {
                id: finalId,
                _id: finalId,
                name: finalName,
                label: formatMemberChipLabel(matchedUser || { name: finalName }),
                department: getCleanDepartment(matchedUser),
              },
            });
          }
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
        } else if (currentDraft.intent === 'create_project') {
          if (!Array.isArray(currentDraft.members)) currentDraft.members = [];
          const exists = currentDraft.members.some(m =>
            (finalId && typeof m === 'object' && String(m.id || m._id) === finalId) ||
            (finalName && ((typeof m === 'string' && m.toLowerCase() === finalName.toLowerCase()) || (typeof m === 'object' && m.name && m.name.toLowerCase() === finalName.toLowerCase())))
          );
          if (!exists) {
            currentDraft.members.push({
              id: finalId,
              name: finalName,
              label: formatMemberChipLabel(matchedUser || { name: finalName }),
            });
          }
        }
        break;
      }
      case 'remove_member': {
        actionHandled = true;
        const memberName = action.name || action.value;
        const memberId = action.userId || action.id || action.assigneeId;
        const matchStr = (val) => {
          if (!val) return false;
          const s = String(val).toLowerCase();
          return (memberId && s === String(memberId).toLowerCase()) || (memberName && s === String(memberName).toLowerCase());
        };

        if (currentDraft.intent === 'create_client') {
          if (Array.isArray(currentDraft.projectManager)) {
            currentDraft.projectManager = currentDraft.projectManager.filter(m =>
              !matchStr(m.id || m._id) && !matchStr(m.name) && !matchStr(m)
            );
            currentDraft.team = currentDraft.projectManager.map(m => m.id);
          }
          currentDraft.teamDone = true;
          if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
          if (!currentDraft.asked.includes('team')) currentDraft.asked.push('team');
        } else if (currentDraft.intent === 'task_assigned_user') {
          if (Array.isArray(currentDraft.assignees)) {
            currentDraft.assignees = currentDraft.assignees.filter(m =>
              !matchStr(m.id || m._id) && !matchStr(m.name) && !matchStr(m)
            );
            currentDraft.assignedUsers = currentDraft.assignees.map(m => m.id);
            if (currentDraft.assignees.length > 0) {
              currentDraft.assigneeId = currentDraft.assignees[0].id;
              currentDraft.assigneeName = currentDraft.assignees.map(m => m.name).join(', ');
              currentDraft.assigneeLabel = currentDraft.assignees.map(m => m.name).join(', ');
            } else {
              currentDraft.assigneeId = null;
              currentDraft.assigneeName = null;
              currentDraft.assigneeLabel = null;
            }
          }
          if (Array.isArray(currentDraft.assigneeLedger)) {
            currentDraft.assigneeLedger = currentDraft.assigneeLedger.filter(e =>
              !matchStr(e.userId || e.id) && !matchStr(e.displayName) && !matchStr(e.rawName)
            );
          }
        } else if (currentDraft.intent === 'create_project') {
          if (Array.isArray(currentDraft.members)) {
            currentDraft.members = currentDraft.members.filter(m =>
              !matchStr(m?.id || m?._id) && !matchStr(m?.name) && !matchStr(m)
            );
          }
        }
        break;
      }
      case 'show_more_members':
        actionHandled = true;
        currentDraft.memberPage = (action.page !== undefined) ? Number(action.page) : ((currentDraft.memberPage || 0) + 1);
        break;
      case 'set_only_self':
        if (currentDraft.intent === 'create_project') {
          currentDraft.members = [req?.user?.name || 'Self'];
        } else if (currentDraft.intent === 'task_project') {
          currentDraft.assignee = req?.user?.name || 'Self';
          currentDraft.assigneeId = req?.user?._id ? String(req.user._id) : null;
        }
        break;
      case 'finish_members':
        if (currentDraft.intent === 'create_project') {
          currentDraft.membersDone = true;
          if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
        } else if (currentDraft.intent === 'create_client') {
          currentDraft.teamDone = true;
          if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
          if (!currentDraft.asked.includes('team')) currentDraft.asked.push('team');
        } else if (currentDraft.intent === 'task_assigned_user') {
          currentDraft.assigneeDone = true;
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
        }
        break;
      case 'confirm_duplicate_project_name':
        currentDraft.duplicateHandled = true;
        break;
      case 'change_project_name':
        currentDraft.name = null;
        currentDraft.duplicateHandled = false;
        break;
      case 'chain_task':
        currentDraft.intent = 'task_project';
        currentDraft.taskFor = 'project';
        currentDraft.projectId = action.projectId || currentDraft.projectId || (currentDraft._id ? String(currentDraft._id) : null);
        currentDraft.projectName = action.projectName || currentDraft.projectName || currentDraft.name;
        currentDraft.title = null;
        currentDraft.description = null;
        currentDraft.dueDateTime = null;
        currentDraft.dueDate = null;
        currentDraft.assigneeId = null;
        currentDraft.assigneeName = null;
        currentDraft.assignees = [];
        currentDraft.assignedUsers = [];
        currentDraft.assigneeLedger = [];
        currentDraft.pendingAssigneeNames = [];
        currentDraft.asked = ['project'];
        currentDraft.skipped = [];
        break;
      case 'finish_chain':
        return {
          success: true,
          status: 'created',
          field: 'done',
          reply: 'Theek hai, naya task nahi banaya gaya. Agar kuch aur chahiye toh batayein!',
          speech: 'ठीक है, नया टास्क नहीं बनाया गया।',
          speakText: 'Theek hai, naya task nahi banaya gaya.',
          draft: null,
          chips: [],
          notices: [],
          progress: { done: 10, total: 10 },
          canAssignOthers,
          meta: { model: modelName },
        };
      case 'keep_title_person':
        currentDraft.titlePersonHandled = true;
        currentDraft.titlePersonCandidate = null;
        break;
      case 'remove_pending_assignee':
      case 'remove_assignee': {
        const toRemove = String(action.name || action.value || action.assigneeId || '').toLowerCase();
        removeLedgerEntry(currentDraft, { name: action.name || action.value, userId: action.assigneeId });
        currentDraft.removedAssignees = Array.isArray(currentDraft.removedAssignees)
          ? [...new Set([...currentDraft.removedAssignees, toRemove])]
          : [toRemove];
        if (Array.isArray(currentDraft.pendingAssigneeNames)) {
          currentDraft.pendingAssigneeNames = currentDraft.pendingAssigneeNames.filter(n =>
            !String(n).toLowerCase().includes(toRemove) && !toRemove.includes(String(n).toLowerCase())
          );
        }
        if (Array.isArray(currentDraft.assignees)) {
          currentDraft.assignees = currentDraft.assignees.filter(a =>
            !String(a.name || '').toLowerCase().includes(toRemove) &&
            !toRemove.includes(String(a.name || '').toLowerCase()) &&
            String(a.id || a._id).toLowerCase() !== toRemove
          );
          currentDraft.assignedUsers = currentDraft.assignees.map(a => String(a.id || a._id));
          if (currentDraft.assignees.length === 1) {
            currentDraft.assigneeId = currentDraft.assignees[0].id;
            currentDraft.assigneeName = currentDraft.assignees[0].name;
            currentDraft.assigneeLabel = currentDraft.assignees[0].label;
          } else if (currentDraft.assignees.length === 0) {
            currentDraft.assigneeId = null;
            currentDraft.assigneeName = null;
            currentDraft.assigneeLabel = null;
          } else {
            currentDraft.assigneeId = currentDraft.assignees[0].id;
            currentDraft.assigneeName = currentDraft.assignees.map(a => a.name).join(', ');
            currentDraft.assigneeLabel = currentDraft.assignees.map(a => a.name).join(', ');
          }
        }
        notices.push(`"${action.name || action.value || 'Assignee'}" ko chhod diya gaya hai.`);
        break;
      }
      case 'set_team_member': {
        const pickedId = String(action.assigneeId || action.value || '');
        const pickedName = action.value || action.name || '';
        updateLedgerWithPick(currentDraft, {
          assigneeId: pickedId,
          name: pickedName,
          pool: [],
        });
        syncAssigneeLedgerDerivedFields(currentDraft);
        const resolvedEntries = (currentDraft.assigneeLedger || []).filter(e => e.status === 'resolved' && e.userId);
        if (resolvedEntries.length > 0) {
          currentDraft.projectManager = resolvedEntries.map(e => ({
            id: e.userId,
            name: e.user?.name || e.displayName || e.rawName,
            label: e.user?.label || e.displayName || e.rawName,
            department: e.user?.department || 'General',
          }));
          currentDraft.team = currentDraft.projectManager.map(m => m.id);
        }
        currentDraft.intent = 'create_client';
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'projectManager' && f !== 'team');
        currentDraft.skipped = (currentDraft.skipped || []).filter(f => f !== 'projectManager' && f !== 'team');
        actionHandled = true;
        break;
      }
      case 'set_project_member': {
        const pickedId = String(action.assigneeId || action.value || '');
        const pickedName = action.value || action.name || '';
        updateLedgerWithPick(currentDraft, {
          assigneeId: pickedId,
          name: pickedName,
          pool: [],
        });
        syncAssigneeLedgerDerivedFields(currentDraft);
        const resolvedEntries = (currentDraft.assigneeLedger || []).filter(e => e.status === 'resolved' && e.userId);
        if (resolvedEntries.length > 0) {
          currentDraft.members = resolvedEntries.map(e => ({
            id: e.userId,
            name: e.displayName || e.rawName,
            label: e.displayName || e.rawName,
          }));
        }
        currentDraft.intent = 'create_project';
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'members');
        currentDraft.skipped = (currentDraft.skipped || []).filter(f => f !== 'members');
        actionHandled = true;
        break;
      }
      case 'finish_more_details':
      case 'finish_client_details':
      case 'skip_more_details': {
        currentDraft.moreDetailsDone = true;
        currentDraft.activeDetailsGroup = null;
        currentDraft.activeGroupField = null;
        actionHandled = true;
        break;
      }
      case 'select_details_group':
      case 'set_details_group':
      case 'ask_client_details_group': {
        const pickedGroup = action.group || action.value;
        if (pickedGroup) {
          currentDraft.activeDetailsGroup = pickedGroup;
          currentDraft.activeGroupField = null;
          currentDraft.servicesDone = true;
          currentDraft.clientPlanDone = true;
        }
        actionHandled = true;
        break;
      }
      case 'add_client_service': {
        if (action.service) {
          currentDraft.services = Array.from(new Set([...(currentDraft.services || []), action.service]));
        }
        actionHandled = true;
        break;
      }
      case 'remove_client_service': {
        if (action.service) {
          currentDraft.services = (currentDraft.services || []).filter(s => s !== action.service);
        }
        actionHandled = true;
        break;
      }
      case 'toggle_client_service': {
        if (action.service) {
          const cur = currentDraft.services || [];
          if (cur.includes(action.service)) {
            currentDraft.services = cur.filter(s => s !== action.service);
          } else {
            currentDraft.services = [...cur, action.service];
          }
        }
        actionHandled = true;
        break;
      }
      case 'finish_client_services': {
        currentDraft.servicesDone = true;
        if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
        actionHandled = true;
        break;
      }
      case 'skip_client_services': {
        currentDraft.servicesDone = true;
        currentDraft.servicesSkipped = true;
        if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
        actionHandled = true;
        break;
      }
      case 'set_client_plan': {
        const planId = action.planId || action.value;
        const planName = action.planName || action.value;
        currentDraft.clientPlanId = planId;
        currentDraft.clientPlanName = planName;
        let foundPlan = null;
        const plansPool = Array.isArray(deps.clientPlans) ? deps.clientPlans : (Array.isArray(scope?.clientPlans) ? scope.clientPlans : []);
        if (plansPool.length > 0) {
          foundPlan = plansPool.find(p => (p._id && p._id.toString() === String(planId)) || p.name === planName || String(p.id) === String(planId));
        }
        if (!foundPlan && (deps.ClientPlan || mongoose.models.ClientPlan)) {
          try {
            const PlanModel = deps.ClientPlan || mongoose.models.ClientPlan;
            const orQ = [];
            if (mongoose.Types.ObjectId.isValid(planId)) orQ.push({ _id: planId });
            orQ.push({ name: planName });
            foundPlan = await PlanModel.findOne({ $or: orQ }).lean();
          } catch {}
        }
        if (foundPlan) {
          currentDraft.clientPlanName = foundPlan.name || planName;
          currentDraft.clientPlanPrice = foundPlan.price;
          currentDraft.clientPlanMonths = foundPlan.months || 1;
          if (Array.isArray(foundPlan.services) && foundPlan.services.length > 0) {
            const planServices = foundPlan.services.map(s => typeof s === 'string' ? s : (s.service || s.name)).filter(Boolean);
            currentDraft.allowedPlanServices = planServices;
            currentDraft.services = [...planServices];
            let tCount = 0;
            foundPlan.services.forEach(s => {
              if (Array.isArray(s.tasks)) tCount += s.tasks.length;
            });
            currentDraft.clientPlanTasksCount = tCount;
          }
        }
        currentDraft.clientPlanDone = true;
        currentDraft.clientPlanSkipped = false;
        currentDraft.servicesDone = true;
        currentDraft.servicesSkipped = false;
        currentDraft.serviceTasksDone = true;
        currentDraft.serviceTasksSkipped = true;
        if (!currentDraft.asked.includes('clientPlan')) currentDraft.asked.push('clientPlan');
        if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
        if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
        actionHandled = true;
        break;
      }
      case 'skip_client_plan': {
        currentDraft.clientPlanDone = true;
        currentDraft.clientPlanSkipped = true;
        currentDraft.clientPlanId = null;
        currentDraft.clientPlanName = null;
        currentDraft.clientPlanPrice = 0;
        currentDraft.clientPlanMonths = 0;
        currentDraft.allowedPlanServices = null;
        currentDraft.services = [];
        currentDraft.servicesDone = false;
        currentDraft.servicesSkipped = false;
        if (!currentDraft.asked.includes('clientPlan')) currentDraft.asked.push('clientPlan');
        actionHandled = true;
        break;
      }
      case 'start_manual_plan': {
        currentDraft.creatingManualPlan = true;
        currentDraft.manualPlan = {
          name: '',
          price: null,
          months: 1,
          status: 'Active',
          description: '',
          services: [],
          step: 'name',
        };
        actionHandled = true;
        break;
      }
      case 'cancel_manual_plan': {
        currentDraft.creatingManualPlan = false;
        currentDraft.manualPlan = null;
        actionHandled = true;
        break;
      }
      case 'set_manual_plan_field': {
        if (currentDraft.manualPlan && action.field) {
          currentDraft.manualPlan[action.field] = action.value;
          if (action.field === 'price') currentDraft.manualPlan.step = 'months';
          else if (action.field === 'months') currentDraft.manualPlan.step = 'status';
          else if (action.field === 'status') currentDraft.manualPlan.step = 'description';
          else if (action.field === 'description') currentDraft.manualPlan.step = 'services';
        }
        actionHandled = true;
        break;
      }
      case 'add_manual_plan_service': {
        if (currentDraft.manualPlan && action.service) {
          currentDraft.manualPlan.services = Array.from(new Set([...(currentDraft.manualPlan.services || []), action.service]));
        }
        actionHandled = true;
        break;
      }
      case 'remove_manual_plan_service': {
        if (currentDraft.manualPlan && action.service) {
          currentDraft.manualPlan.services = (currentDraft.manualPlan.services || []).filter(s => s !== action.service);
        }
        actionHandled = true;
        break;
      }
      case 'finish_manual_plan_services': {
        if (currentDraft.manualPlan) {
          currentDraft.manualPlan.step = 'ready';
        }
        actionHandled = true;
        break;
      }
      case 'edit_manual_plan': {
        if (currentDraft.manualPlan) {
          currentDraft.manualPlan.step = action.field || 'name';
        }
        actionHandled = true;
        break;
      }
      case 'save_and_use_plan': {
        if (currentDraft.manualPlan) {
          const mPlan = currentDraft.manualPlan;
          let savedPlan = null;
          try {
            if (mongoose?.connection?.readyState !== 1) throw new Error('DB not connected');
            const PlanModel = deps.ClientPlan || mongoose.models.ClientPlan || require('../../HR-CDS/models/ClientPlan');
            const cleanCode = cleanCompanyCode || req?.user?.companyCode || (req?.user?.company && req?.user?.company?.companyCode) || 'DEFAULT';
            savedPlan = await PlanModel.create({
              companyCode: cleanCode,
              name: mPlan.name || 'Custom Plan',
              price: Number(mPlan.price || 0),
              months: Number(mPlan.months || 1),
              description: mPlan.description || '',
              services: (mPlan.services || []).map(s => ({
                service: typeof s === 'string' ? s : (s.service || s.name),
                tasks: []
              })),
              isActive: mPlan.status !== 'Inactive'
            });
          } catch (e) {
            savedPlan = {
              _id: 'plan_' + Date.now(),
              name: mPlan.name || 'Custom Plan',
              price: Number(mPlan.price || 0),
              months: Number(mPlan.months || 1),
              description: mPlan.description || '',
              services: (mPlan.services || []).map(s => ({ service: typeof s === 'string' ? s : (s.service || s.name), tasks: [] })),
              isActive: mPlan.status !== 'Inactive'
            };
          }
          if (Array.isArray(deps.clientPlans)) {
            deps.clientPlans.push(savedPlan);
          }
          currentDraft.clientPlanId = String(savedPlan._id || savedPlan.id);
          currentDraft.clientPlanName = savedPlan.name;
          currentDraft.clientPlanPrice = savedPlan.price;
          currentDraft.clientPlanMonths = savedPlan.months || 1;
          currentDraft.clientPlanDone = true;
          currentDraft.clientPlanSkipped = false;
          currentDraft.allowedPlanServices = (savedPlan.services || []).map(s => s.service || s);
          currentDraft.services = [...currentDraft.allowedPlanServices];
          currentDraft.servicesDone = true;
          currentDraft.serviceTasksDone = true;
          currentDraft.creatingManualPlan = false;
          currentDraft.manualPlan = null;
          if (!currentDraft.asked.includes('clientPlan')) currentDraft.asked.push('clientPlan');
          if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
          if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
        }
        actionHandled = true;
        break;
      }

      case 'toggle_plan_service': {
        actionHandled = true;
        const svc = action.service;
        if (svc) {
          const cur = Array.isArray(currentDraft.services) ? currentDraft.services : [];
          const idx = cur.findIndex(s => (typeof s === 'string' ? s : s.service).toLowerCase() === svc.toLowerCase());
          if (idx >= 0) {
            currentDraft.services = cur.filter((_, i) => i !== idx);
          } else {
            currentDraft.services = [...cur, svc];
          }
        }
        break;
      }
      case 'finish_plan_services': {
        actionHandled = true;
        currentDraft.servicesDone = true;
        if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
        break;
      }
      case 'skip_plan_description':
      case 'skip_description': {
        actionHandled = true;
        currentDraft.description = '';
        currentDraft.descriptionDone = true;
        currentDraft.descriptionSkipped = true;
        if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
        break;
      }
      case 'start_add_service_tasks': {
        actionHandled = true;
        currentDraft.addingServiceTasks = true;
        currentDraft.activeTaskService = null;
        currentDraft.lastAddedService = null;
        break;
      }
      case 'pick_another_service': {
        actionHandled = true;
        currentDraft.addingServiceTasks = true;
        currentDraft.activeTaskService = null;
        currentDraft.lastAddedService = null;
        break;
      }
      case 'finish_service_tasks':
      case 'skip_service_tasks': {
        actionHandled = true;
        currentDraft.addingServiceTasks = false;
        currentDraft.activeTaskService = null;
        currentDraft.lastAddedService = null;
        currentDraft.serviceTasksDone = true;
        const hasTasks = Boolean(currentDraft.customTasks?.length > 0 || (currentDraft.serviceTasks && Object.values(currentDraft.serviceTasks).some(a => Array.isArray(a) && a.length > 0)));
        currentDraft.serviceTasksSkipped = !hasTasks;
        if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
        break;
      }
      case 'select_task_service': {
        actionHandled = true;
        currentDraft.addingServiceTasks = true;
        currentDraft.activeTaskService = action.service;
        currentDraft.lastAddedService = null;
        break;
      }
      case 'add_service_task': {
        actionHandled = true;
        const sName = action.service || currentDraft.activeTaskService || currentDraft.lastAddedService;
        const tName = action.name || action.taskName;
        if (sName && tName) {
          if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
          if (!Array.isArray(currentDraft.serviceTasks[sName])) currentDraft.serviceTasks[sName] = [];
          currentDraft.serviceTasks[sName].push({
            name: String(tName).trim(),
            description: String(action.description || '').trim(),
            priority: ['Low', 'Medium', 'High'].includes(action.priority) ? action.priority : 'Medium',
            dueInDays: Number(action.dueInDays || 30)
          });
          if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
          currentDraft.customTasks.push({
            service: sName,
            name: String(tName).trim(),
            description: String(action.description || '').trim(),
            priority: ['Low', 'Medium', 'High'].includes(action.priority) ? action.priority : 'Medium',
            dueInDays: Number(action.dueInDays || 30)
          });
          currentDraft.lastAddedService = sName;
          currentDraft.activeTaskService = null;
          ackPrefix = `"${tName}" task "${sName}" mein add ho gaya. `;
          currentDraft.lastTaskNotice = `"${tName}" task "${sName}" mein add ho gaya. `;
        }
        break;
      }

      case 'set_subscription_start_date': {
        const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('./clientSlotFiller');
        const rawDate = action.value || action.startDate || 'today';
        const parsedDate = parseRelativeOrAbsoluteDate(rawDate) || rawDate;
        currentDraft.subscriptionStartDate = parsedDate;
        if (currentDraft.clientPlanMonths) {
          currentDraft.subscriptionEndDate = calculateEndDate(parsedDate, currentDraft.clientPlanMonths);
        }
        if (!currentDraft.asked.includes('subscriptionStartDate')) currentDraft.asked.push('subscriptionStartDate');
        actionHandled = true;
        break;
      }
      case 'finish_details_group': {
        if (!Array.isArray(currentDraft.completedDetailsGroups)) {
          currentDraft.completedDetailsGroups = [];
        }
        const groupToFinish = action.group || currentDraft.activeDetailsGroup;
        if (groupToFinish && !currentDraft.completedDetailsGroups.includes(groupToFinish)) {
          currentDraft.completedDetailsGroups.push(groupToFinish);
        }
        currentDraft.activeDetailsGroup = null;
        currentDraft.activeGroupField = null;
        actionHandled = true;
        break;
      }
      case 'skip_client_field': {
        if (!Array.isArray(currentDraft.skippedDetailsFields)) {
          currentDraft.skippedDetailsFields = [];
        }
        const f = action.field || currentDraft.activeGroupField;
        if (f && !currentDraft.skippedDetailsFields.includes(f)) {
          currentDraft.skippedDetailsFields.push(f);
        }
        if (f === 'logo' || currentDraft.activeDetailsGroup === 'logo') {
          if (!Array.isArray(currentDraft.completedDetailsGroups)) currentDraft.completedDetailsGroups = [];
          if (!currentDraft.completedDetailsGroups.includes('logo')) currentDraft.completedDetailsGroups.push('logo');
          currentDraft.activeDetailsGroup = null;
          currentDraft.activeGroupField = null;
        }
        actionHandled = true;
        break;
      }
      case 'set':
        if (action.field === 'taskFor') {
          if (action.value === 'project') {
            const migration = migrateDraftBetweenIntents(currentDraft.intent, 'task_project', currentDraft);
            Object.assign(currentDraft, migration.newDraft);
            currentDraft.taskFor = 'project';
          } else {
            const targetIntent = action.value === 'others' ? 'task_assigned_user' : 'self_task';
            const migration = migrateDraftBetweenIntents(currentDraft.intent, targetIntent, currentDraft);
            Object.assign(currentDraft, migration.newDraft);
            currentDraft.taskFor = action.value === 'others' ? 'others' : 'self';
            if (action.value === 'others') {
              currentDraft.wantsOthers = true;
              currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
            } else {
              currentDraft.wantsOthers = false;
              currentDraft.assigneeId = null;
              currentDraft.assigneeName = null;
              currentDraft.assigneeLabel = null;
              if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
            }
          }
        } else if (action.field === 'intent') {
          const targetIntent = action.value;
          if (FORM_REGISTRY[targetIntent]) {
            const migration = migrateDraftBetweenIntents(currentDraft.intent, targetIntent, currentDraft);
            Object.assign(currentDraft, migration.newDraft);
          }
        } else if (action.field === 'removeAssignee' || action.field === 'remove_pending_assignee' || action.type === 'remove_pending_assignee') {
          const removedName = String(action.value || action.name || action.assigneeId || '');
          removeLedgerEntry(currentDraft, { name: removedName, userId: action.assigneeId });
          notices.push(`"${action.name || action.value || 'Assignee'}" ko chhod diya gaya hai.`);
        } else if (action.field === 'assignee') {
          if (currentDraft.intent === 'self_task') {
            currentDraft.taskFor = 'others';
            currentDraft.wantsOthers = true;
            currentDraft.intent = 'task_assigned_user';
          }
          currentDraft.titlePersonHandled = true;
          currentDraft.titlePersonCandidate = null;
          if (action.value && !action.assigneeId && !pick?.assigneeId) {
            currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [action.value]);
            syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'task_assigned_user' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.assigneeDone = true;
          }
        }

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
          }
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        } else if (action.field === 'reminder') {
          currentDraft.reminder = Boolean(action.value);
          if (currentDraft.reminder) {
            currentDraft.reminderOption = currentDraft.reminderOption || 'oneHourBefore';
          } else {
            currentDraft.reminderOption = null;
            currentDraft.repeatIntervalMinutes = null;
            currentDraft.minutesBeforeDue = null;
            currentDraft.customTime = null;
            currentDraft.reminderTime = null;
          }
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
        } else if (action.field === 'reminderOption') {
          currentDraft.reminderOption = action.value || 'oneHourBefore';
          currentDraft.reminder = true;
          if (action.value === 'hourly') currentDraft.repeatIntervalMinutes = 60;
          if (action.value === 'halfHourly') currentDraft.repeatIntervalMinutes = 30;
          if (action.value === 'oneHourBefore') currentDraft.minutesBeforeDue = null;
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
        } else if (action.field === 'repeatIntervalMinutes') {
          currentDraft.repeatIntervalMinutes = Number(action.value);
          currentDraft.reminder = true;
          currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field === 'minutesBeforeDue') {
          currentDraft.minutesBeforeDue = Number(action.value);
          currentDraft.reminder = true;
          currentDraft.reminderOption = currentDraft.minutesBeforeDue === 60 ? 'oneHourBefore' : 'beforeDue';
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field === 'customTime' || action.field === 'reminderTime') {
          currentDraft.customTime = action.value;
          currentDraft.reminderTime = action.value;
          currentDraft.reminder = true;
          currentDraft.reminderOption = 'custom';
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field === 'members') {
          if (action.value === 'creator_only' || action.value === 'Sirf main' || action.value === 'main') {
            const creatorName = req?.user?.name || 'Aap';
            const creatorId = String(req?.user?._id || req?.user?.id || 'creator');
            currentDraft.members = [{ id: creatorId, name: creatorName, label: creatorName }];
          } else if (Array.isArray(action.value)) {
            currentDraft.members = action.value;
          } else if (typeof action.value === 'string') {
            if (action.assigneeId && Array.isArray(currentDraft.assigneeLedger)) {
              const unres = getFirstUnresolvedLedgerEntry(currentDraft);
              if (unres) {
                unres.status = 'resolved';
                unres.userId = String(action.assigneeId);
                unres.displayName = action.value;
                unres.user = {
                  id: String(action.assigneeId),
                  _id: String(action.assigneeId),
                  name: action.value,
                  label: action.value,
                  department: action.department || 'General',
                };
              }
              const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
              currentDraft.members = resolvedEntries.map(e => ({
                id: e.userId,
                name: e.user?.name || e.displayName || e.rawName,
                label: e.user?.label || e.displayName || e.rawName,
                department: e.user?.department || 'General',
              }));
            } else {
              const mNames = extractMultipleAssignees(action.value).names;
              if (mNames && mNames.length > 0) {
                currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, mNames);
              }
            }
          }
          if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'members');
        } else if (action.field === 'subscriptionStartDate') {
          const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('./clientSlotFiller');
          const parsed = parseRelativeOrAbsoluteDate(action.value) || action.value;
          currentDraft.subscriptionStartDate = parsed;
          if (currentDraft.clientPlanMonths) {
            currentDraft.subscriptionEndDate = calculateEndDate(parsed, currentDraft.clientPlanMonths);
          }
          if (!currentDraft.asked.includes('subscriptionStartDate')) currentDraft.asked.push('subscriptionStartDate');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'subscriptionStartDate');
        } else if (action.field === 'checkpoints') {
          const parsed = Array.isArray(action.value) ? action.value : parseCheckpointItems(String(action.value || ''));
          currentDraft.checkpoints = parsed;
          if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'checkpoints');
        } else if (action.field) {
          currentDraft[action.field] = action.value;
          if (!currentDraft.asked.includes(action.field)) currentDraft.asked.push(action.field);
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
          if (action.field === 'companyLogoName' || action.field === 'companyLogo') {
            if (!Array.isArray(currentDraft.completedDetailsGroups)) currentDraft.completedDetailsGroups = [];
            if (!currentDraft.completedDetailsGroups.includes('logo')) currentDraft.completedDetailsGroups.push('logo');
            currentDraft.activeDetailsGroup = null;
            currentDraft.activeGroupField = null;
            notices.push(`Logo "${action.value}" attach ho gaya.`);
          }
        }
        break;
      case 'pickProject':
        // Project selection handled by targetPickedProjectId above
        break;
      case 'skip': {
        const targetField = action.field || lastAskedField;
        if (targetField === 'more_details') {
          currentDraft.moreDetailsDone = true;
          currentDraft.activeDetailsGroup = null;
          currentDraft.activeGroupField = null;
          actionHandled = true;
          break;
        }
        if (currentDraft.activeGroupField && (targetField === currentDraft.activeGroupField || targetField === 'skip')) {
          if (!Array.isArray(currentDraft.skippedDetailsFields)) currentDraft.skippedDetailsFields = [];
          if (!currentDraft.skippedDetailsFields.includes(currentDraft.activeGroupField)) {
            currentDraft.skippedDetailsFields.push(currentDraft.activeGroupField);
          }
          actionHandled = true;
          break;
        }
        if (targetField) {
          if (targetField === 'title') {
            currentDraft.title = null;
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'title');
            return {
              success: true,
              status: 'needs_input',
              field: 'title',
              reply: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
              speech: 'टास्क का नाम ज़रूरी है, इसको स्किप नहीं कर सकते। कृपया टास्क का नाम बताएं।',
              speakText: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
              draft: currentDraft,
              missing: ['title'],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 10 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (currentDraft.intent === 'create_project' && ['name', 'description', 'startDate', 'endDate', 'members'].includes(targetField)) {
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== targetField);
            const msgMap = {
              name: 'Project ka naam zaroori hai, isko skip nahi kar sakte. Kripya project ka naam batayein:',
              description: 'Project ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
              startDate: 'Project ki start date zaroori hai, isko skip nahi kar sakte. Kripya start date batayein:',
              endDate: 'Project ki end date zaroori hai, isko skip nahi kar sakte. Kripya end date batayein:',
              members: 'Kam se kam ek team member zaroori hai, isko skip nahi kar sakte. Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)',
            };
            return {
              success: true,
              status: 'needs_input',
              field: targetField,
              reply: msgMap[targetField] || `${targetField} zaroori hai.`,
              speech: msgMap[targetField] || `${targetField} zaroori hai.`,
              speakText: msgMap[targetField] || `${targetField} zaroori hai.`,
              draft: currentDraft,
              missing: [targetField],
              chips: targetField === 'members' ? [{ label: 'Sirf main', action: { type: 'set', field: 'members', value: 'creator_only' } }] : [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (currentDraft.intent === 'create_client' && ['client', 'company', 'city', 'projectManager'].includes(targetField)) {
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== targetField);
            const msgMap = {
              client: 'Client ka naam zaroori hai, isko skip nahi kar sakte. Kripya client ka naam batayein:',
              company: 'Company ka naam zaroori hai, isko skip nahi kar sakte. Kripya company ka naam batayein:',
              city: 'City zaroori hai, isko skip nahi kar sakte. Kripya city batayein:',
              projectManager: 'Kam se kam ek team member chunna zaroori hai, isko skip nahi kar sakte. Kripya team member ka naam batayein:',
            };
            return {
              success: true,
              status: 'needs_input',
              field: targetField,
              reply: msgMap[targetField] || `${targetField} zaroori hai.`,
              speech: msgMap[targetField] || `${targetField} zaroori hai.`,
              speakText: msgMap[targetField] || `${targetField} zaroori hai.`,
              draft: currentDraft,
              missing: [targetField],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 4 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (currentDraft.intent === 'self_task' && targetField === 'description') {
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'description');
            const isEn = userLang === 'en';
            return {
              success: true,
              status: 'needs_input',
              field: 'description',
              reply: isEn ? 'Task description is required and cannot be skipped. Please provide a description:' : 'Task ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
              speech: isEn ? 'Task description is required and cannot be skipped. Please provide a description.' : 'टास्क का डिस्क्रिप्शन जरूरी है, इसको स्किप नहीं कर सकते। कृपया डिस्क्रिप्शन बताएं।',
              speakText: isEn ? 'Task description is required, please provide a description.' : 'Task ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
              speakTextHi: isEn ? null : 'टास्क का Description जरूरी है, इसको skip नहीं कर सकते। कृपया Description बताएं:',
              draft: currentDraft,
              missing: ['description'],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 1, total: 10 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (!currentDraft.skipped.includes(targetField)) currentDraft.skipped.push(targetField);
          if (targetField === 'description') currentDraft.description = '';
          if (targetField === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
          if (targetField === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
          if (targetField === 'reminder') currentDraft.reminder = false;
          if (targetField === 'priorityDays') currentDraft.priorityDays = '1';
          if (targetField === 'repeatPattern') currentDraft.repeatPattern = 'none';
          if (targetField === 'checkpoints') currentDraft.checkpoints = [];
          if (targetField === 'attachments' || targetField === 'file') {
            currentDraft.attachmentsCount = 0;
            currentDraft.file = null;
            currentDraft.pdfFile = null;
          }
          if (targetField === 'assignee' && currentDraft.intent === 'task_project' && formatProjectStatus(currentDraft.status) !== 'in progress') {
            currentDraft.assigneeId = null;
            currentDraft.assigneeName = null;
            currentDraft.assigneeLabel = null;
          }
        }
        break;
      }
      case 'skip_all': {
        const allOptional = currentDraft.intent === 'create_project'
          ? ['priority', 'status', 'pdfFile']
          : (currentDraft.intent === 'create_client'
            ? ['email', 'phone', 'industry', 'gst', 'pan', 'website', 'address', 'state', 'country', 'pincode', 'description', 'notes', 'more_details']
            : (currentDraft.intent === 'self_task'
              ? (currentDraft.description ? ['priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file'] : ['priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file'])
              : ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file']));
        if (currentDraft.intent === 'create_client') {
          currentDraft.moreDetailsDone = true;
        }
        // In task_project when status is not 'in progress', assignee is optional ONLY IF not already set
        if (
          currentDraft.intent === 'task_project' &&
          formatProjectStatus(currentDraft.status) !== 'in progress' &&
          !currentDraft.assigneeId &&
          !currentDraft.assigneeName &&
          (!Array.isArray(currentDraft.assignees) || currentDraft.assignees.length === 0)
        ) {
          if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
        }
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
            if (fieldKey === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments' || fieldKey === 'file') {
              currentDraft.attachmentsCount = 0;
              currentDraft.file = null;
              currentDraft.pdfFile = null;
            }
          }
        });
        break;
      }
      case 'attachments':
        currentDraft.attachmentsCount = Number(action.count || 0);
        if (!currentDraft.asked.includes('attachments')) currentDraft.asked.push('attachments');
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'attachments');
        break;
      case 'ask':
        if (action.field) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
          currentDraft[action.field] = null;
          if (action.field === 'reminder') {
            currentDraft.reminder = null;
            currentDraft.reminderOption = null;
            currentDraft.repeatIntervalMinutes = null;
            currentDraft.minutesBeforeDue = null;
            currentDraft.customTime = null;
          }
          currentDraft.asked = currentDraft.asked.filter((f) => f !== action.field);
        }
        break;
      case 'edit':
        if (action.field === 'project') {
          currentDraft.projectId = null;
          currentDraft.projectName = null;
          currentDraft.project = null;
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
          currentDraft.asked = currentDraft.asked.filter((f) => f !== 'project');
        } else if (action.field === 'assignee') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
          currentDraft.assigneeId = null;
          currentDraft.assigneeName = null;
          currentDraft.assigneeLabel = null;
        } else if (action.field === 'subscriptionStartDate') {
          const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('./clientSlotFiller');
          const parsed = parseRelativeOrAbsoluteDate(action.value) || action.value;
          currentDraft.subscriptionStartDate = parsed;
          if (currentDraft.clientPlanMonths) {
            currentDraft.subscriptionEndDate = calculateEndDate(parsed, currentDraft.clientPlanMonths);
          }
          if (!currentDraft.asked.includes('subscriptionStartDate')) currentDraft.asked.push('subscriptionStartDate');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'subscriptionStartDate');
        } else if (action.field === 'checkpoints') {
          currentDraft.checkpoints = [];
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'checkpoints');
          currentDraft.asked = currentDraft.asked.filter((f) => f !== 'checkpoints');
        } else if (action.field) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
          currentDraft[action.field] = null;
          currentDraft.asked = currentDraft.asked.filter((f) => f !== action.field);
        } else {
          wantsEditPrompt = true;
        }
        break;
      case 'confirm': {
        if (currentDraft.intent === 'create_client_task') {
          let savedTask = null;
          try {
            if (mongoose?.connection?.readyState === 1) {
              const ClientTaskModel = deps.ClientTask || mongoose.models.ClientTask || require('../../HR-CDS/models/ClientTask');
              const cleanCode = cleanCompanyCode || req?.user?.companyCode || (req?.user?.company && req?.user?.company?.companyCode) || 'DEFAULT';
              const effectiveDueDate = currentDraft.dueDateTime || currentDraft.dueDate || new Date().toISOString();
              savedTask = await ClientTaskModel.create({
                companyCode: cleanCode,
                clientId: currentDraft.clientId,
                client: currentDraft.client,
                service: currentDraft.service,
                name: currentDraft.title,
                description: currentDraft.description || '',
                dueDate: effectiveDueDate,
                dueDateTime: effectiveDueDate,
                assignee: currentDraft.assignee || '',
                assigneeId: currentDraft.assigneeId || null,
                priority: currentDraft.priority || 'Medium',
                status: 'pending',
                completed: false,
              });
            }
          } catch (e) {
            console.error('Error creating client task:', e);
          }

          const successMsg = `"${currentDraft.title}" task "${currentDraft.client}" ki "${currentDraft.service}" service mein successfully create ho gaya! ✅`;
          return {
            success: true,
            status: 'created',
            field: 'post_client_task_creation',
            reply: successMsg,
            speech: successMsg,
            speakText: successMsg,
            chips: [
              { label: `${currentDraft.service} mein aur task add karein`, action: { type: 'set_client_task_service', service: currentDraft.service } },
              { label: 'Kisi aur service mein', action: { type: 'set_intent', intent: 'create_client_task', client: currentDraft.client, clientId: currentDraft.clientId, clientServices: currentDraft.clientServices || [] } },
              { label: 'Main Menu', action: { type: 'reset' } },
            ],
            draft: currentDraft,
            payload: FORM_REGISTRY.create_client_task.buildPayload(currentDraft, req?.user || {}),
            preview: FORM_REGISTRY.create_client_task.buildPreview(currentDraft, req?.user || {}),
            createdTask: savedTask,
            canAssignOthers,
          };
        } else if (currentDraft.intent === 'create_client_plan') {
          let savedPlan = null;
          try {
            if (mongoose?.connection?.readyState !== 1) throw new Error('DB not connected');
            const PlanModel = deps.ClientPlan || mongoose.models.ClientPlan || require('../../HR-CDS/models/ClientPlan');
            const cleanCode = cleanCompanyCode || req?.user?.companyCode || (req?.user?.company && req?.user?.company?.companyCode) || 'DEFAULT';
            savedPlan = await PlanModel.create({
              companyCode: cleanCode,
              name: currentDraft.name || 'Client Plan',
              price: Number(currentDraft.price || 0),
              months: Number(currentDraft.months || 1),
              description: currentDraft.description || '',
              services: (Array.isArray(currentDraft.services) ? currentDraft.services : []).map(s => ({
                service: typeof s === 'string' ? s : (s.service || s.name),
                tasks: []
              })),
              isActive: currentDraft.status !== 'Inactive'
            });
          } catch (e) {
            savedPlan = {
              _id: 'plan_' + Date.now(),
              name: currentDraft.name || 'Client Plan',
              price: Number(currentDraft.price || 0),
              months: Number(currentDraft.months || 1),
              description: currentDraft.description || '',
              services: (Array.isArray(currentDraft.services) ? currentDraft.services : []).map(s => ({
                service: typeof s === 'string' ? s : (s.service || s.name),
                tasks: []
              })),
              isActive: currentDraft.status !== 'Inactive'
            };
          }
          if (Array.isArray(deps.clientPlans)) {
            deps.clientPlans.push(savedPlan);
          }
          currentDraft.savedPlan = savedPlan;
          currentDraft.planSaved = true;
          return {
            success: true,
            status: 'created',
            reply: `Client Plan "${currentDraft.name}" successfully create aur save ho gaya hai! Ab yeh plan "Add Client" me bhi available hai.`,
            speech: `Client Plan "${currentDraft.name}" ban gaya.`,
            speakText: `Client Plan "${currentDraft.name}" successfully create aur save ho gaya hai!`,
            draft: currentDraft,
            plan: savedPlan,
            chips: [
              { label: 'Personal task banana', action: { type: 'set_intent', intent: 'self_task' } },
              { label: 'Naya client add karna', action: { type: 'set_intent', intent: 'create_client' } },
            ]
          };
        }
        break;
      }
      default:
        actionHandled = false;
        break;
    }
  }

  const rawMessage = typeof message === 'string' ? message.trim() : '';
  const trimmedMessage = rawMessage ? normalizeTranscript(rawMessage) : '';
  const detectedIntent = trimmedMessage ? detectUserIntent(trimmedMessage) : null;
  const isDraftInProgress = Boolean(
    (currentDraft.title && String(currentDraft.title).trim()) ||
    (currentDraft.name && String(currentDraft.name).trim()) ||
    (currentDraft.client && String(currentDraft.client).trim()) ||
    (Array.isArray(currentDraft.asked) && currentDraft.asked.length > 0)
  );

  const explicitLang = (language && language !== 'hinglish') ? language : null;
  const prevLang = draft?.language || currentDraft?.language;
  let userLang;
  const isLanguageSwitchCommand = /\b(?:speak|talk|reply|answer|switch|change)\s*(?:in|to)?\s*(?:english|hindi|hinglish)\b/i.test(trimmedMessage);
  const isShortOrAction = !trimmedMessage || /^(?:skip|skip\s+remaining|high|medium|low|urgent|pending|in[- ]progress|completed|on[- ]hold|\d+|yes|no|haan|nahi|default|cancel)$/i.test(trimmedMessage);
  if (prevLang && !isLanguageSwitchCommand && (isDraftInProgress || isShortOrAction)) {
    userLang = prevLang;
  } else {
    userLang = detectMessageLanguage(trimmedMessage, explicitLang || prevLang || 'hinglish');
  }
  currentDraft.language = userLang;

  // --------------------------------------------------------------------------
  // CONVERSATIONAL ROUTER 1: Chit-chat & Greetings (ChatGPT-like natural replies)
  // --------------------------------------------------------------------------
  if (!actionHandled && trimmedMessage && isChitChatOrGreeting(trimmedMessage) && !isDraftInProgress) {
    const chatReply = getChitChatReply(trimmedMessage, req?.user, now, userLang);
    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);

    Object.keys(currentDraft).forEach(k => {
      if (k !== 'history' && k !== '_id') delete currentDraft[k];
    });
    currentDraft.intent = null;
    currentDraft.asked = [];
    currentDraft.skipped = [];
    currentDraft.askCounts = {};

    const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: chatReply.reply,
      speech: chatReply.speech,
      speakText: chatReply.speakText,
      speakTextHi: chatReply.speakTextHi,
      draft: null,
      chips: welcomeChips,
      candidates: [],
      notices: [],
      canAssignOthers,
      language: userLang,
      meta: { model: modelName },
    };
  }

  // --------------------------------------------------------------------------
  // CONVERSATIONAL ROUTER 2: Out of Scope / Strict CRM Boundary Guardrails
  // --------------------------------------------------------------------------
  if (!actionHandled && trimmedMessage && isOutOfScopeQuery(trimmedMessage) && !isDraftInProgress) {
    const oosReply = getOutOfScopeReply(trimmedMessage, req?.user, userLang);
    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);

    Object.keys(currentDraft).forEach(k => {
      if (k !== 'history' && k !== '_id') delete currentDraft[k];
    });
    currentDraft.intent = null;
    currentDraft.asked = [];
    currentDraft.skipped = [];
    currentDraft.askCounts = {};

    const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: oosReply.reply,
      speech: oosReply.speech,
      speakText: oosReply.speakText,
      speakTextHi: oosReply.speakTextHi,
      draft: null,
      chips: welcomeChips,
      candidates: [],
      notices: [],
      canAssignOthers,
      language: userLang,
      meta: { model: modelName },
    };
  }

  // --------------------------------------------------------------------------
  // DETERMINISTIC INFO QUESTIONS REGEX (Used by info router and query breaker)
  // --------------------------------------------------------------------------
  const INFO_MEMBERS_REGEX = /(?:(?:k[ao]n\s+k[ao]n\s+(?:se\s+)?member[as]*)|(?:member[as]*\s+(?:dikhao|batao|list|kaun|kon))|(?:(?:team|company)\s+(?:k[ao]n|mein\s+k[ao]n|main\s+k[ao]n|ke\s+log))|(?:team\s+members?\s+(?:dikhao|batao|list))|(?:show\s+members?|list\s+members?|members?\s+list)|(?:k[ao]n\s+k[ao]n\s+hai\s+team\s+(?:mein|main))|kaun\s+kaun\s+members\s+hain|members\s+dikhao|members\s+batao|team\s+ke\s+log\s+kaun\s+hain|team\s+members\s+dikhao|kaun\s+kaun\s+hai\s+team\s+mein|कौन\s*कौन\s*मेंबर्स\s*हैं|मेंबर्स\s*दिखाओ|मेंबर्स\s*बताओ|टीम\s*के\s*लोग\s*कौन\s*हैं|मेंबर्स\s*की\s*लिस्ट)/iu;
  const INFO_SERVICES_REGEX = /(?:services\s+kaun\s+si\s+hain|services\s+dikhao|services\s+batao|kaun\s+kaun\s+si\s+services\s+hain|show\s+services|list\s+services|services\s+list|सर्विसेज\s*कौन\s*सी\s*हैं|सर्विसेज\s*दिखाओ|सर्विसेज\s*बताओ|सर्विसेज\s*की\s*लिस्ट)/iu;
  const INFO_PLANS_REGEX = /(?:plans\s+kya\s+hain|plans\s+dikhao|plans\s+batao|kaun\s+se\s+plans\s+hain|show\s+plans|list\s+plans|plans\s+list|प्लान्स\s*क्या\s*हैं|प्लान्स\s*दिखाओ|प्लान्स\s*बताओ|प्लान्स\s*की\s*लिस्ट)/iu;
  const INFO_CLIENTS_REGEX = /(?:clients\s+dikhao|kaun\s+se\s+clients\s+hain|clients\s+batao|client\s+list|clients\s+list|show\s+clients|क्लाइंट्स\s*दिखाओ|कौन\s*से\s*क्लाइंट्स\s*हैं|क्लाइंट्स\s*बताओ|क्लाइंट्स\s*की\s*लिस्ट)/iu;
  const INFO_PROJECTS_REGEX = /(?:projects\s+dikhao|kaun\s+se\s+projects\s+hain|projects\s+batao|project\s+list|projects\s+list|show\s+projects|प्रोजेक्ट्स\s*दिखाओ|कौन\s*से\s*प्रोजेक्ट्स\s*हैं|प्रोजेक्ट्स\s*बताओ|प्रोजेक्ट्स\s*की\s*लिस्ट)/iu;

  const isInfoMsg = trimmedMessage && (
    INFO_MEMBERS_REGEX.test(trimmedMessage) ||
    INFO_SERVICES_REGEX.test(trimmedMessage) ||
    INFO_PLANS_REGEX.test(trimmedMessage) ||
    INFO_CLIENTS_REGEX.test(trimmedMessage) ||
    INFO_PROJECTS_REGEX.test(trimmedMessage)
  );

  // --------------------------------------------------------------------------
  // CONVERSATIONAL ROUTER 3: Intelligent CRM Read Queries (tasks, projects, clients)
  // --------------------------------------------------------------------------
  if (!actionHandled && (!isDraftInProgress || !isInfoMsg) && trimmedMessage && isCrmQuery(trimmedMessage) && !isActionOrCreationCommand(trimmedMessage)) {
    const crmResult = await handleCrmQuery(trimmedMessage, req, deps, userLang, {
      accessibleProjects,
      accessibleClients,
      canAssignOthers,
      companyUsers: deps.companyUsers,
      draft: currentDraft,
      scope,
    });
    if (crmResult) return crmResult;
  }

  // --------------------------------------------------------------------------
  // CONVERSATIONAL ROUTER 4: CRM Task Status Mutations (e.g. mark completed)
  // --------------------------------------------------------------------------
  if (!actionHandled && (!isDraftInProgress || currentDraft.intent === 'self_task' || currentDraft.intent === 'task_assigned_user') && trimmedMessage && isCrmTaskUpdate(trimmedMessage)) {
    const updateResult = await handleCrmUpdate(trimmedMessage, req, deps, userLang, {
      accessibleProjects,
      accessibleClients,
      canAssignOthers,
      companyUsers: deps.companyUsers,
      draft: currentDraft,
      scope,
    });
    if (updateResult) return updateResult;
  }

  // --------------------------------------------------------------------------
  // DETERMINISTIC INFO QUESTIONS (Zero LLM, draft untouched, repeated pending slot)
  // --------------------------------------------------------------------------
  if (isInfoMsg) {
    let infoText = '';
    if (INFO_MEMBERS_REGEX.test(trimmedMessage)) {
      const userList = (deps.companyUsers || scope.users || []).map((u) => '• ' + formatMemberChipLabel(u)).join('\n');
      infoText = 'Available members:\n' + (userList || 'Koi members nahi mile.');
    } else if (INFO_SERVICES_REGEX.test(trimmedMessage)) {
      const sList = (deps.services || scope.services || []).map((s) => '• ' + (typeof s === 'string' ? s : (s.servicename || s.name))).join('\n');
      infoText = 'Available services:\n' + (sList || 'Koi services nahi mili.');
    } else if (INFO_PLANS_REGEX.test(trimmedMessage)) {
      const pList = (deps.clientPlans || []).map((p) => '• ' + (p.name || p.planName) + (p.price != null ? ' (₹' + Number(p.price).toLocaleString('en-IN') + ')' : '')).join('\n');
      infoText = 'Available plans:\n' + (pList || 'Koi plans nahi mile.');
    } else if (INFO_CLIENTS_REGEX.test(trimmedMessage)) {
      const cList = (deps.accessibleClients || []).map((c) => '• ' + (c.client || c.name) + (c.company ? ' (' + c.company + ')' : '')).join('\n');
      infoText = 'Available clients:\n' + (cList || 'Koi clients nahi mile.');
    } else if (INFO_PROJECTS_REGEX.test(trimmedMessage)) {
      const prList = (accessibleProjects || []).map((p) => '• ' + (p.projectName || p.name)).join('\n');
      infoText = 'Available projects:\n' + (prList || 'Koi projects nahi mile.');
    }

    const pendingField = lastAskedField || (currentDraft.intent === 'create_client' ? 'client' : (currentDraft.intent === 'create_project' ? 'name' : 'title'));
    const pendingQuestion = getPendingSlotQuestion(currentDraft.intent, pendingField);
    const fullReply = infoText + '\n\n' + pendingQuestion;
    const infoChips = buildChips(currentDraft.intent, pendingField, { ...deps, draft: currentDraft, user: req?.user, accessibleProjects, companyUsers: deps.companyUsers, language: userLang });
    assertChipsAllowed(currentDraft.intent, pendingField, infoChips);

    return {
      success: true,
      status: 'needs_input',
      field: pendingField,
      reply: fullReply,
      speech: infoText.split('\n')[0] + '. ' + pendingQuestion,
      speakText: infoText.split('\n')[0] + '. ' + pendingQuestion,
      speakTextHi: infoText.split('\n')[0] + '. ' + pendingQuestion,
      draft: currentDraft,
      chips: infoChips,
      candidates: [],
      notices,
      canAssignOthers,
    };
  }

  if (!actionHandled && trimmedMessage && /^(?:main\s+menu|menu|menu\s+par\s+jayein|go\s+to\s+menu|home)$/i.test(trimmedMessage)) {
    Object.keys(currentDraft).forEach(k => {
      if (k !== 'history' && k !== '_id') delete currentDraft[k];
    });
    currentDraft.intent = null;
    currentDraft.asked = [];
    currentDraft.skipped = [];
    currentDraft.askCounts = {};

    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);
    const welcomeMsg = getWelcomeMessage(req?.user, now, userLang);
    const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
    return {
      success: true,
      status: 'open',
      field: 'welcome',
      reply: welcomeMsg.reply,
      speech: welcomeMsg.speech,
      speakText: welcomeMsg.speakText,
      speakTextHi: welcomeMsg.speakTextHi,
      draft: null,
      chips: welcomeChips,
      candidates: [],
      notices: [],
      canAssignOthers,
      meta: { model: modelName },
    };
  }

  const detectedIntentResult = detectIntent({
    message: trimmedMessage,
    draft: currentDraft,
    canAssignOthers,
    accessibleProjects,
  });

  // --------------------------------------------------------------------------
  // DYNAMIC CONVERSATIONAL & CRM QUERY HANDLER (Groq LLM)
  // Handles any open query, project members query, or natural question intelligently
  // --------------------------------------------------------------------------
  if (!actionHandled && !isDraftInProgress && trimmedMessage && !isActionOrCreationCommand(trimmedMessage) && !isCrmTaskUpdate(trimmedMessage) && (!detectedIntentResult.isExplicit || !detectedIntentResult.isSupported)) {
    try {
      const groqAnswer = await answerWithGroqCRM({
        message: trimmedMessage,
        user: req?.user,
        accessibleProjects,
        accessibleClients,
        companyUsers: deps.companyUsers,
        tasks: deps.tasks,
        clientPlans: deps.clientPlans,
        services: deps.services,
        clientTasks: deps.clientTasks,
        language: userLang
      });

      if (groqAnswer) {
        const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);
        const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
        const refProject = findReferencedProject(trimmedMessage, accessibleProjects, currentDraft);
        const projId = refProject ? String(refProject._id || refProject.id) : (currentDraft.lastProjectId || null);
        const projName = refProject ? (refProject.projectName || refProject.name) : (currentDraft.lastProjectName || null);

        let activeChips = welcomeChips;
        if (refProject) {
          activeChips = [
            { label: 'View Tasks', action: { type: 'view_project_tasks', projectId: String(refProject._id || refProject.id) } },
            { label: 'Team members list', action: { type: 'view_project_members', projectId: String(refProject._id || refProject.id) } },
            { label: 'Main menu', action: { type: 'reset' } }
          ];
        }

        return {
          success: true,
          status: 'open',
          field: 'welcome',
          reply: groqAnswer,
          speech: groqAnswer.split('\n')[0].replace(/[*_#]/g, ''),
          speakText: groqAnswer,
          speakTextHi: groqAnswer,
          draft: {
            ...(projId ? { lastProjectId: projId, lastProjectName: projName } : {})
          },
          chips: activeChips,
          candidates: [],
          notices: [],
          canAssignOthers
        };
      }
    } catch (llmErr) {
      console.warn('[taskAgentService] Groq conversational fallback error:', llmErr);
    }
  }

  if (detectedIntentResult.isAmbiguous) {
    let rep = detectedIntentResult.question;
    const chipsKey = (detectedIntentResult.chips || []).map((c) => c.label).sort().join('|');
    if (
      currentDraft._lastReply === rep &&
      currentDraft._lastChipsKey === chipsKey &&
      rawMessage &&
      currentDraft._lastUserMsg &&
      rawMessage.trim().toLowerCase() !== currentDraft._lastUserMsg.trim().toLowerCase()
    ) {
      rep = `Mujhe samajh nahi aaya. ${rep}`;
    }
    currentDraft._lastReply = rep;
    currentDraft._lastChipsKey = chipsKey;
    currentDraft._lastUserMsg = rawMessage ? rawMessage.trim() : '';

    return {
      success: true,
      status: 'needs_input',
      field: 'intent',
      reply: rep,
      speech: 'क्या यह टास्क किसी प्रोजेक्ट के अंदर बनाना है या सामान्य टास्क?',
      speakText: 'Kya yeh task kisi project ke andar banana hai ya normal task?',
      draft: currentDraft,
      missing: ['intent'],
      chips: detectedIntentResult.chips,
      candidates: [],
      notices,
      progress: { done: 0, total: 10 },
      canAssignOthers,
      intent: { type: 'ambiguous_intent' },
      meta: { model: modelName },
    };
  }

  if (detectedIntentResult.isExplicit && detectedIntentResult.isSupported && detectedIntentResult.intent !== currentDraft.intent) {
    const migration = migrateDraftBetweenIntents(currentDraft.intent, detectedIntentResult.intent, currentDraft);
    Object.assign(currentDraft, migration.newDraft);
  }

  const hasExplicitSelfPhrase = /(?:\b(?:personal\s+task|self\s+task|my\s+task|apna\s+task|mera\s+(?:personal\s+)?task|khud\s+ka\s+task)\b|(?:(?:मेरा|मेरी|मेरे|अपना|अपने|खुद|स्वयं)\s*(?:एक\s*)?(?:नया\s*)?(?:पर्सनल|परशन|स्वयं|खुद)?\s*(?:टास्क|काम))|(?:(?:पर्सनल|परशन)\s*(?:टास्क|काम)))/iu.test(trimmedMessage);
  const mentionsProjectLocative = /\b(?:project\s+mein|in\s+(?:the\s+)?project|project\s+me|ke\s+andar\s+task)\b/i.test(trimmedMessage);

  const mentionsOtherOrProject = !hasExplicitSelfPhrase && (
    /\b(?:assign|kisi\s+aur|dusre|someone\s+else|project|member)\b/i.test(trimmedMessage) ||
    detectedIntentResult.intent === 'task_assigned_user' ||
    detectedIntentResult.intent === 'task_project'
  );

  const isExplicitPersonalTask = (hasExplicitSelfPhrase && !mentionsProjectLocative) ||
    (!mentionsOtherOrProject && (
      (detectedIntentResult.intent === 'self_task' && detectedIntentResult.isExplicit) ||
      (draft?.intent === 'self_task' && !mentionsOtherOrProject)
    ));

  if (isExplicitPersonalTask) {
    currentDraft.intent = 'self_task';
    currentDraft.taskFor = 'self';
    currentDraft.wantsOthers = false;
    currentDraft.projectId = null;
    currentDraft.projectName = null;
    currentDraft.project = null;
    currentDraft.assigneeName = null;
    currentDraft.assigneeId = null;
    currentDraft.assigneeLabel = null;
    currentDraft.assignees = [];
    currentDraft.assignedUsers = [];
    currentDraft.pendingAssigneeNames = [];
    currentDraft.assigneeLedger = [];
  }

  // If detected intent is task_project or user explicitly requested a project task, populate project:
  const isProjectTaskIntent = !isExplicitPersonalTask && (
    detectedIntentResult.intent === 'task_project' ||
    /\b(?:project\s+task|task\s+in\s+project|project\s+mein|in\s+(?:the\s+)?project)\b/i.test(trimmedMessage)
  );

  if (isProjectTaskIntent && !currentDraft.projectId && Array.isArray(accessibleProjects) && accessibleProjects.length > 0) {
    const p = (Array.isArray(detectedIntentResult.matchedProjects) && detectedIntentResult.matchedProjects[0]) ||
      findReferencedProject(trimmedMessage, accessibleProjects, currentDraft);
    if (p) {
      currentDraft.projectId = String(p._id || p.id);
      currentDraft.projectName = p.projectName || p.name;
      currentDraft.project = currentDraft.projectName;
      currentDraft.projectStartDate = p.startDate;
      currentDraft.intent = 'task_project';
      currentDraft.taskFor = 'project';
      if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
      currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
    }
  }

  // --------------------------------------------------------------------------
  // CREATE_CLIENT_TASK PIPELINE (Client Service Task)
  // --------------------------------------------------------------------------
  if (currentDraft.intent === 'create_client_task' || detectedIntentResult.intent === 'create_client_task') {
    currentDraft.intent = 'create_client_task';
    const ClientModel = deps.Client || mongoose.models.Client || require('../../HR-CDS/models/Client');
    let clientDoc = null;
    const targetClient = currentDraft.client || currentDraft.clientName || pick?.client || action?.client || action?.clientId;
    const pool = Array.isArray(deps.accessibleClients) ? deps.accessibleClients : [];
    if (targetClient && pool.length > 0) {
      clientDoc = pool.find(c => String(c._id || c.id) === String(targetClient) || (c.client && c.client.toLowerCase() === String(targetClient).toLowerCase())) || findReferencedClient(String(targetClient), pool);
    }
    if (!clientDoc && targetClient && ClientModel && mongoose?.connection?.readyState === 1) {
      try {
        clientDoc = await ClientModel.findOne({
          $or: [
            ...(mongoose.Types.ObjectId.isValid(targetClient) ? [{ _id: targetClient }] : []),
            { client: { $regex: '^' + String(targetClient).trim() + '$', $options: 'i' } }
          ],
          ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
        }).populate('projectManager').lean();
      } catch {}
    }
    if (!clientDoc && targetClient && action?.client) {
      clientDoc = {
        _id: action.clientId || targetClient,
        client: action.client,
        services: action.clientServices || pool.find(c => c.client === action.client)?.services || []
      };
    }
    if (!clientDoc && trimmedMessage && pool.length > 0) {
      const matchInPool = findReferencedClient(trimmedMessage, pool);
      if (matchInPool) clientDoc = matchInPool;
    }

    if (clientDoc) {
      currentDraft.client = clientDoc.client;
      currentDraft.clientId = String(clientDoc._id || clientDoc.id || currentDraft.clientId || '');
      if (Array.isArray(clientDoc.services) && clientDoc.services.length > 0) {
        currentDraft.clientServices = clientDoc.services;
      }
      if (Array.isArray(clientDoc.projectManager) && clientDoc.projectManager.length > 0) {
        currentDraft.clientProjectManagers = clientDoc.projectManager;
      }
      if (!currentDraft.asked.includes('client')) currentDraft.asked.push('client');
    }

    // 1. If NO client chosen yet:
    if (!currentDraft.client) {
      const askClientReply = 'Kaun se client ke liye service task banana hai? Client select kijiye:';
      const clientChips = (pool.length > 0 ? pool : []).map(c => ({
        label: ((c.client || '') + (c.company ? ` - ${c.company}` : '')).trim(),
        action: { type: 'set_client_task_client', client: c.client, clientId: String(c._id || c.id) }
      }));
      clientChips.push({ label: 'Cancel', action: { type: 'cancel' } });
      return {
        success: true,
        status: 'needs_input',
        field: 'client',
        reply: askClientReply,
        speech: 'Kaun se client ke liye task banana hai?',
        speakText: askClientReply,
        draft: currentDraft,
        missing: ['client'],
        chips: clientChips,
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // 2. Client is chosen. Check services:
    const availableServices = Array.isArray(currentDraft.clientServices) ? currentDraft.clientServices : [];
    if (availableServices.length === 0) {
      const noServicesReply = `Client "${currentDraft.client}" ke paas abhi koi service assign nahi hai. Kripya pehle client ko service ya plan assign karein.`;
      return {
        success: true,
        status: 'needs_input',
        field: 'client',
        reply: noServicesReply,
        speech: noServicesReply,
        speakText: noServicesReply,
        draft: currentDraft,
        missing: ['service'],
        chips: [
          { label: 'Naya Client Banayein', action: { type: 'set_intent', intent: 'create_client' } },
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Check if user replied with a service name
    if (!currentDraft.service && trimmedMessage) {
      const matchSvc = availableServices.find(s => {
        const sName = typeof s === 'string' ? s : (s.service || s.name);
        return sName && (trimmedMessage.toLowerCase().includes(sName.toLowerCase()) || sName.toLowerCase().includes(trimmedMessage.toLowerCase()));
      });
      if (matchSvc) {
        currentDraft.service = typeof matchSvc === 'string' ? matchSvc : (matchSvc.service || matchSvc.name);
        if (!currentDraft.asked.includes('service')) currentDraft.asked.push('service');
      }
    }

    // 3. If service is not chosen yet:
    if (!currentDraft.service) {
      const askServiceReply = `Client "${currentDraft.client}" ke liye kaun si service mein task banana hai? Service select kijiye:`;
      const serviceChips = availableServices.map(s => {
        const sName = typeof s === 'string' ? s : (s.service || s.name);
        return {
          label: sName,
          action: { type: 'set_client_task_service', service: sName }
        };
      });
      serviceChips.push({ label: 'Cancel', action: { type: 'cancel' } });
      return {
        success: true,
        status: 'needs_input',
        field: 'service',
        reply: askServiceReply,
        speech: askServiceReply,
        speakText: askServiceReply,
        draft: currentDraft,
        missing: ['service'],
        chips: serviceChips,
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Extract any slots present in trimmedMessage:
    const parsedSlots = parseHinglishSlots(trimmedMessage, now);
    if (parsedSlots.title && !currentDraft.title) {
      currentDraft.title = parsedSlots.title;
      if (!currentDraft.asked.includes('title')) currentDraft.asked.push('title');
    }
    if (parsedSlots.description && !currentDraft.description) {
      currentDraft.description = parsedSlots.description;
      if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
    }
    if (parsedSlots.dueDateTime && !currentDraft.dueDateTime) {
      currentDraft.dueDateTime = parsedSlots.dueDateTime;
      currentDraft.dueDate = parsedSlots.dueDateTime.split('T')[0];
      if (!currentDraft.asked.includes('dueDateTime')) currentDraft.asked.push('dueDateTime');
    }
    if (parsedSlots.priority && !currentDraft.priority) {
      currentDraft.priority = parsedSlots.priority;
      if (!currentDraft.asked.includes('priority')) currentDraft.asked.push('priority');
    }
    if (parsedSlots.reminder && (currentDraft.reminder === null || currentDraft.reminder === undefined)) {
      currentDraft.reminder = parsedSlots.reminder;
      currentDraft.reminderSettings = parsedSlots.reminder;
      if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
    }
    if (Array.isArray(parsedSlots.checkpoints) && parsedSlots.checkpoints.length > 0 && (!currentDraft.checkpoints || currentDraft.checkpoints.length === 0)) {
      currentDraft.checkpoints = parsedSlots.checkpoints;
      currentDraft.checkpointsAsked = true;
      if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
    }

    // Both Client and Service are selected!
    // Handle user inputs for subsequent fields (title, description, dueDateTime, assignee, priority, reminder, checkpoints)
    const lastAsked = lastAskedField || (currentDraft.asked.length > 0 ? currentDraft.asked[currentDraft.asked.length - 1] : null);

    if (!actionHandled && trimmedMessage) {
      if (lastAsked === 'title' && !currentDraft.title) {
        currentDraft.title = trimmedMessage;
        if (!currentDraft.asked.includes('title')) currentDraft.asked.push('title');
        actionHandled = true;
      } else if (lastAsked === 'description' && (!currentDraft.description || currentDraft.description === '')) {
        currentDraft.description = trimmedMessage;
        if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
        actionHandled = true;
      } else if ((lastAsked === 'dueDateTime' || lastAsked === 'dueDate') && !currentDraft.dueDateTime && !currentDraft.dueDate) {
        const parsed = parseHinglishSlots(trimmedMessage, now);
        if (parsed?.dueDateTime) {
          currentDraft.dueDateTime = parsed.dueDateTime;
          currentDraft.dueDate = parsed.dueDateTime.split('T')[0];
        } else {
          const dateObj = new Date(trimmedMessage);
          if (!isNaN(dateObj.getTime())) {
            currentDraft.dueDateTime = dateObj.toISOString();
            currentDraft.dueDate = dateObj.toISOString().split('T')[0];
          } else {
            const defaultDate = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
            currentDraft.dueDateTime = defaultDate.toISOString();
            currentDraft.dueDate = defaultDate.toISOString().split('T')[0];
          }
        }
        if (!currentDraft.asked.includes('dueDateTime')) currentDraft.asked.push('dueDateTime');
        actionHandled = true;
      } else if (lastAsked === 'assignee' && !currentDraft.assignee && !currentDraft.asked.includes('assignee')) {
        if (/mujhe|myself|self|khud|apne|skip|unassigned/i.test(trimmedMessage)) {
          currentDraft.assignee = req?.user?.name || req?.user?.userName || 'Aap khud';
          currentDraft.assigneeId = req?.user?._id || req?.user?.id || null;
        } else {
          const poolUsers = [
            ...(Array.isArray(currentDraft.clientProjectManagers) ? currentDraft.clientProjectManagers : []),
            ...(Array.isArray(deps.companyUsers) ? deps.companyUsers : [])
          ];
          const matchedU = poolUsers.find(u => u.name && trimmedMessage.toLowerCase().includes(u.name.toLowerCase()));
          if (matchedU) {
            currentDraft.assignee = matchedU.name;
            currentDraft.assigneeId = String(matchedU._id || matchedU.id || '');
          } else {
            currentDraft.assignee = trimmedMessage;
          }
        }
        if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
        actionHandled = true;
      } else if (lastAsked === 'priority' && !currentDraft.priority && !currentDraft.asked.includes('priority')) {
        if (/high/i.test(trimmedMessage)) currentDraft.priority = 'High';
        else if (/low/i.test(trimmedMessage)) currentDraft.priority = 'Low';
        else currentDraft.priority = 'Medium';
        if (!currentDraft.asked.includes('priority')) currentDraft.asked.push('priority');
        actionHandled = true;
      } else if (lastAsked === 'reminder' && (currentDraft.reminder === null || currentDraft.reminder === undefined)) {
        if (/off|nahi|no|mat|chhod/i.test(trimmedMessage)) {
          currentDraft.reminder = false;
          currentDraft.reminderOption = 'off';
          currentDraft.reminderSettings = { enabled: false };
        } else {
          const parsed = parseHinglishSlots(trimmedMessage, now);
          if (parsed?.reminder) {
            currentDraft.reminder = parsed.reminder;
            currentDraft.reminderSettings = parsed.reminder;
          } else {
            currentDraft.reminder = true;
            currentDraft.reminderOption = 'every10Minutes';
            currentDraft.reminderSettings = { enabled: true, reminderOption: 'every10Minutes', repeatIntervalMinutes: 10 };
          }
        }
        if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
        actionHandled = true;
      } else if (lastAsked === 'checkpoints' && !currentDraft.checkpointsAsked) {
        if (/nahi|no|skip|mat|koi nahi|chhod/i.test(trimmedMessage)) {
          currentDraft.checkpoints = [];
        } else {
          const items = typeof parseCheckpointItems === 'function' ? parseCheckpointItems(trimmedMessage) : trimmedMessage.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
          currentDraft.checkpoints = items.map(t => typeof t === 'string' ? { title: t, completed: false } : (t && t.title ? { title: String(t.title), completed: Boolean(t.completed) } : { title: String(t), completed: false }));
        }
        currentDraft.checkpointsAsked = true;
        if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
        actionHandled = true;
      }
    }

    // Now decide next slot to ask:
    // Slot 3: Task Title (REQUIRED)
    if (!currentDraft.title) {
      if (!currentDraft.asked.includes('title')) currentDraft.asked.push('title');
      const titleReply = `Task ka naam (title) batao jo "${currentDraft.service}" mein add karna hai:`;
      return {
        success: true,
        status: 'needs_input',
        field: 'title',
        reply: titleReply,
        speech: titleReply,
        speakText: titleReply,
        draft: currentDraft,
        missing: ['title'],
        chips: [{ label: 'Cancel', action: { type: 'cancel' } }],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 4: Task Description (REQUIRED - NO SKIP CHIP)
    if (!currentDraft.description || currentDraft.description === '') {
      if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
      const descReply = 'Task ka description kya rakhna hai? Description batayein:';
      return {
        success: true,
        status: 'needs_input',
        field: 'description',
        reply: descReply,
        speech: descReply,
        speakText: descReply,
        draft: currentDraft,
        missing: ['description'],
        chips: [
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 5: Due Date & Time (REQUIRED - NO SKIP CHIP)
    if (!currentDraft.dueDateTime && !currentDraft.dueDate) {
      if (!currentDraft.asked.includes('dueDateTime')) currentDraft.asked.push('dueDateTime');
      const dueReply = 'Ye task kab tak complete hona chahiye? Date aur time batayein:';
      const today6pm = new Date(now);
      today6pm.setHours(18, 0, 0, 0);
      const tomorrow11am = new Date(now);
      tomorrow11am.setDate(tomorrow11am.getDate() + 1);
      tomorrow11am.setHours(11, 0, 0, 0);
      const threeDays = new Date(now);
      threeDays.setDate(threeDays.getDate() + 3);
      threeDays.setHours(18, 0, 0, 0);
      const oneWeek = new Date(now);
      oneWeek.setDate(oneWeek.getDate() + 7);
      oneWeek.setHours(18, 0, 0, 0);

      return {
        success: true,
        status: 'needs_input',
        field: 'dueDateTime',
        reply: dueReply,
        speech: dueReply,
        speakText: dueReply,
        draft: currentDraft,
        missing: ['dueDateTime'],
        chips: [
          { label: 'Aaj shaam 6:00 PM', action: { type: 'set', field: 'dueDateTime', value: today6pm.toISOString() } },
          { label: 'Kal 11:00 AM', action: { type: 'set', field: 'dueDateTime', value: tomorrow11am.toISOString() } },
          { label: '3 Din baad', action: { type: 'set', field: 'dueDateTime', value: threeDays.toISOString() } },
          { label: '1 Hafta', action: { type: 'set', field: 'dueDateTime', value: oneWeek.toISOString() } },
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 6: Assignee (defaults to logged-in employee if skipped)
    if (currentDraft.assignee === null || (!currentDraft.assignee && !currentDraft.asked.includes('assignee'))) {
      if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
      const loggedUserName = req?.user?.name || req?.user?.userName || 'Aap khud';
      const loggedUserId = String(req?.user?._id || req?.user?.id || '');
      const assignReply = `Ye task kisse assign karna hai? (Default: ${loggedUserName} - Logged-in employee)`;
      const assignChips = [
        { label: `${loggedUserName} (Logged-in employee)`, action: { type: 'set_client_task_assignee', assignee: loggedUserName, assigneeId: loggedUserId } }
      ];
      const teamList = [
        ...(Array.isArray(currentDraft.clientProjectManagers) ? currentDraft.clientProjectManagers : []),
        ...(Array.isArray(deps.companyUsers) ? deps.companyUsers : [])
      ];
      const seen = new Set([loggedUserName.toLowerCase()]);
      teamList.forEach(m => {
        const mName = m.name || m.label || '';
        const mId = String(m._id || m.id || '');
        if (mName && !seen.has(mName.toLowerCase())) {
          seen.add(mName.toLowerCase());
          assignChips.push({
            label: mName,
            action: { type: 'set_client_task_assignee', assignee: mName, assigneeId: mId }
          });
        }
      });
      assignChips.push({ label: 'Unassigned', action: { type: 'skip_client_task_assignee' } });
      assignChips.push({ label: 'Cancel', action: { type: 'cancel' } });
      return {
        success: true,
        status: 'needs_input',
        field: 'assignee',
        reply: assignReply,
        speech: assignReply,
        speakText: assignReply,
        draft: currentDraft,
        missing: ['assignee'],
        chips: assignChips,
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 7: Priority (NO SKIP CHIP)
    if (!currentDraft.priority && !currentDraft.asked.includes('priority')) {
      if (!currentDraft.asked.includes('priority')) currentDraft.asked.push('priority');
      const prioReply = 'Priority kya rakhein? High, Medium ya Low?';
      return {
        success: true,
        status: 'needs_input',
        field: 'priority',
        reply: prioReply,
        speech: prioReply,
        speakText: prioReply,
        draft: currentDraft,
        missing: ['priority'],
        chips: [
          { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
          { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
          { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
          { label: 'Default (Medium)', action: { type: 'set', field: 'priority', value: 'Medium' } },
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 8: Reminder Settings
    if ((currentDraft.reminder === null || currentDraft.reminder === undefined) && !currentDraft.asked.includes('reminder')) {
      if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
      const reminderReply = 'Kya task ke liye reminder lagana hai?';
      return {
        success: true,
        status: 'needs_input',
        field: 'reminder',
        reply: reminderReply,
        speech: reminderReply,
        speakText: reminderReply,
        draft: currentDraft,
        missing: ['reminder'],
        chips: [
          { label: 'Reminder OFF', action: { type: 'set_client_task_reminder', reminder: false, reminderOption: 'off' } },
          { label: 'Har 10 min', action: { type: 'set_client_task_reminder', reminder: true, reminderOption: 'every10Minutes', repeatIntervalMinutes: 10 } },
          { label: 'Har 30 min', action: { type: 'set_client_task_reminder', reminder: true, reminderOption: 'every30Minutes', repeatIntervalMinutes: 30 } },
          { label: 'Har 1 ghanta', action: { type: 'set_client_task_reminder', reminder: true, reminderOption: 'hourly', repeatIntervalMinutes: 60 } },
          { label: 'Har 2 ghante', action: { type: 'set_client_task_reminder', reminder: true, reminderOption: 'every2Hours', repeatIntervalMinutes: 120 } },
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // Slot 9: Checkpoints
    if (!currentDraft.checkpointsAsked && !currentDraft.asked.includes('checkpoints')) {
      currentDraft.checkpointsAsked = true;
      if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
      const cpReply = 'Checkpoints add karne hain? Comma daal kar likhein (jaise: test 1, checking crm, testing) ya "Koi checkpoint nahi" chunein:';
      return {
        success: true,
        status: 'needs_input',
        field: 'checkpoints',
        reply: cpReply,
        speech: cpReply,
        speakText: cpReply,
        draft: currentDraft,
        missing: ['checkpoints'],
        chips: [
          { label: 'Koi checkpoint nahi', action: { type: 'skip_client_task_checkpoints' } },
          { label: 'Cancel', action: { type: 'cancel' } }
        ],
        candidates: [],
        notices,
        canAssignOthers,
      };
    }

    // ALL SLOTS ARE FILLED! Move directly to READY state!
    currentDraft.priority = currentDraft.priority || 'Medium';
    currentDraft.assignee = currentDraft.assignee || req?.user?.name || req?.user?.userName || '';
    currentDraft.assigneeId = currentDraft.assigneeId || req?.user?._id || req?.user?.id || null;
    currentDraft.checkpoints = Array.isArray(currentDraft.checkpoints) ? currentDraft.checkpoints : [];
    currentDraft.reminderSettings = buildReminderPayload(currentDraft.reminderSettings || currentDraft.reminder);
    const payload = FORM_REGISTRY.create_client_task.buildPayload(currentDraft, req?.user || {});
    const preview = FORM_REGISTRY.create_client_task.buildPreview(currentDraft, req?.user || {});

    const readyReply = `Task "${currentDraft.title}" "${currentDraft.client}" ki "${currentDraft.service}" service ke liye ready hai. Kya ise create kar doon?`;
    return {
      success: true,
      status: 'ready',
      field: 'ready',
      reply: readyReply,
      speech: readyReply,
      speakText: readyReply,
      draft: currentDraft,
      missing: [],
      chips: [
        { label: 'Haan, create karo', action: { type: 'confirm' } },
        { label: 'Kuch badalna hai', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } }
      ],
      candidates: [],
      notices,
      canAssignOthers,
      payload,
      preview,
      meta: { model: modelName },
    };
  }

    // Permission enforcement for create_project:
  if (currentDraft.intent === 'create_project' || detectedIntentResult.intent === 'create_project') {
    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);
    if (!allowedIntents.includes('create_project')) {
      const denial = getPermissionDeniedReply('create_project', allowedIntents, req?.user, userLang);
      const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
      return {
        success: true,
        status: 'needs_input',
        field: 'intent',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        draft: null,
        chips: welcomeChips,
        notices: [],
        canAssignOthers,
        language: userLang,
        intent: { type: 'permission_denied' },
        meta: { model: modelName },
      };
    }
    currentDraft.intent = 'create_project';
    if (detectedIntentResult.projectName && !currentDraft.name) {
      currentDraft.name = detectedIntentResult.projectName;
    }
  }

  // Permission enforcement for create_client (Item 8):
  if (currentDraft.intent === 'create_client' || detectedIntentResult.intent === 'create_client') {
    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);
    if (!allowedIntents.includes('create_client')) {
      const denial = getPermissionDeniedReply('create_client', allowedIntents, req?.user, userLang);
      const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
      return {
        success: true,
        status: 'needs_input',
        field: 'intent',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        draft: null,
        chips: welcomeChips,
        notices: [],
        canAssignOthers,
        language: userLang,
        intent: { type: 'permission_denied' },
        meta: { model: modelName },
      };
    }
    currentDraft.intent = 'create_client';
    if (detectedIntentResult.clientName && !currentDraft.client) {
      currentDraft.client = detectedIntentResult.clientName;
    }
    if (detectedIntentResult.clientSlots) {
      const cSlots = detectedIntentResult.clientSlots;
      if (cSlots.client && !currentDraft.client) currentDraft.client = cSlots.client;
      if (cSlots.company && !currentDraft.company) currentDraft.company = cSlots.company;
      if (cSlots.city && !currentDraft.city) currentDraft.city = cSlots.city;
      if (cSlots.email && !currentDraft.email) currentDraft.email = cSlots.email;
      if (cSlots.phone && !currentDraft.phone) currentDraft.phone = cSlots.phone;
      if (cSlots.gst && !currentDraft.gst) currentDraft.gst = cSlots.gst;
      if (cSlots.pan && !currentDraft.pan) currentDraft.pan = cSlots.pan;
      if (cSlots.website && !currentDraft.website) currentDraft.website = cSlots.website;
      if (cSlots.address && !currentDraft.address) currentDraft.address = cSlots.address;
      if (cSlots.state && !currentDraft.state) currentDraft.state = cSlots.state;
      if (cSlots.pincode && !currentDraft.pincode) currentDraft.pincode = cSlots.pincode;
      if (cSlots.industry && !currentDraft.industry) currentDraft.industry = cSlots.industry;
      if (cSlots.description && !currentDraft.description) currentDraft.description = cSlots.description;
      if (cSlots.notes && !currentDraft.notes) currentDraft.notes = cSlots.notes;
      if (Array.isArray(cSlots.services) && cSlots.services.length > 0) {
        currentDraft.services = Array.from(new Set([...(currentDraft.services || []), ...cSlots.services]));
        currentDraft.servicesDone = true;
      }
      if (cSlots.clientPlan && !currentDraft.clientPlanName) {
        currentDraft.clientPlanName = cSlots.clientPlan;
        let foundPlan = null;
        if (scope.clientPlans && Array.isArray(scope.clientPlans)) {
          foundPlan = scope.clientPlans.find(p => p.name && p.name.toLowerCase() === cSlots.clientPlan.toLowerCase());
        }
        if (!foundPlan && (deps.ClientPlan || mongoose.models.ClientPlan)) {
          try {
            const PlanModel = deps.ClientPlan || mongoose.models.ClientPlan;
            foundPlan = await PlanModel.findOne({ name: new RegExp("^cSlots.clientPlan$", "i") }).lean();
          } catch {}
        }
        if (foundPlan) {
          currentDraft.clientPlanDone = true;
          currentDraft.clientPlanId = foundPlan._id ? foundPlan._id.toString() : foundPlan.name;
          currentDraft.clientPlanName = foundPlan.name;
          currentDraft.clientPlanPrice = foundPlan.price;
          currentDraft.clientPlanMonths = foundPlan.months || 1;
          if (Array.isArray(foundPlan.services) && foundPlan.services.length > 0) {
            const planServices = foundPlan.services.map(s => typeof s === 'string' ? s : (s.service || s.name)).filter(Boolean);
            currentDraft.services = Array.from(new Set([...(currentDraft.services || []), ...planServices]));
            let tCount = 0;
            foundPlan.services.forEach(s => {
              if (Array.isArray(s.tasks)) tCount += s.tasks.length;
            });
            currentDraft.clientPlanTasksCount = tCount;
          }
        }
      }
      if (cSlots.subscriptionStartDate && !currentDraft.subscriptionStartDate) {
        const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('./clientSlotFiller');
        const parsedDate = parseRelativeOrAbsoluteDate(cSlots.subscriptionStartDate) || cSlots.subscriptionStartDate;
        currentDraft.subscriptionStartDate = parsedDate;
        if (currentDraft.clientPlanMonths) {
          currentDraft.subscriptionEndDate = calculateEndDate(parsedDate, currentDraft.clientPlanMonths);
        }
      }
      if (cSlots.companyLogo && !currentDraft.companyLogo) {
        currentDraft.companyLogo = cSlots.companyLogo;
      }
    }
  }

  // Permission enforcement for create_client_plan:
  if (currentDraft.intent === 'create_client_plan' || detectedIntentResult.intent === 'create_client_plan') {
    const allowedIntents = resolveUserAllowedIntents(req?.user, scope, deps);
    if (!allowedIntents.includes('create_client_plan')) {
      const denial = getPermissionDeniedReply('create_client_plan', allowedIntents, req?.user, userLang);
      const welcomeChips = buildChips(null, 'welcome', { ...deps, allowedIntents, language: userLang });
      return {
        success: true,
        status: 'needs_input',
        field: 'intent',
        reply: denial.reply,
        speech: denial.speech,
        speakText: denial.speakText,
        speakTextHi: denial.speakTextHi,
        draft: null,
        chips: welcomeChips,
        notices: [],
        canAssignOthers,
        language: userLang,
        intent: { type: 'permission_denied' },
        meta: { model: modelName },
      };
    }
    currentDraft.intent = 'create_client_plan';
  }

  // Permission enforcement: if user cannot assign others, force to self_task
  if (!canAssignOthers && (currentDraft.taskFor === 'others' || currentDraft.intent === 'task_assigned_user') && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_project') {
    currentDraft.taskFor = 'self';
    currentDraft.wantsOthers = false;
    currentDraft.intent = 'self_task';
    currentDraft.assigneeName = null;
    currentDraft.assigneeId = null;
    currentDraft.assigneeLabel = null;
    currentDraft.assignees = [];
    currentDraft.assignedUsers = [];
    currentDraft.pendingAssigneeNames = [];
    notices.push('Aapko dusron ko task assign karne ki permission nahi hai, isliye ye aapke liye banaunga.');
  }

  // -------------------------------------------------------------
  // Cancel Intent: immediately stops creation and returns cancelled status
  // -------------------------------------------------------------
  if (detectedIntent?.type === 'cancel' || action?.type === 'cancel') {
    const currentIntent = currentDraft?.intent || draft?.intent;
    let reply = 'Task creation cancel kar diya gaya hai. Jab chahein naya task shuru karein.';
    let speech = 'टास्क कैंसिल कर दिया गया है। जब चाहें नया टास्क शुरू करें।';
    let speakText = 'Task creation cancel kar diya gaya hai.';
    let chips = [{ label: 'Naya Task Banayein', action: { type: 'reset' } }];

    if (currentIntent === 'create_client') {
      reply = 'Client add karna cancel kar diya gaya hai. Jab chahein naya client add karein.';
      speech = 'क्लाइंट जोड़ना कैंसिल कर दिया गया है। जब चाहें नया क्लाइंट जोड़ें।';
      speakText = 'Client add karna cancel kar diya gaya hai.';
      chips = [
        { label: 'Naya Client Add Karein', action: { type: 'set_intent', intent: 'create_client' } },
        { label: 'Main Menu', action: { type: 'reset' } },
      ];
    } else if (currentIntent === 'create_client_plan') {
      reply = 'Client plan banana cancel kar diya gaya hai. Jab chahein naya plan banayein.';
      speech = 'क्लाइंट प्लान बनाना कैंसिल कर दिया गया है। जब चाहें नया प्लान बनाएं।';
      speakText = 'Client plan banana cancel kar diya gaya hai.';
      chips = [
        { label: 'Naya Plan Banayein', action: { type: 'set_intent', intent: 'create_client_plan' } },
        { label: 'Main Menu', action: { type: 'reset' } },
      ];
    } else if (currentIntent === 'create_project') {
      reply = 'Project creation cancel kar diya gaya hai. Jab chahein naya project shuru karein.';
      speech = 'प्रोजेक्ट कैंसिल कर दिया गया है। जब चाहें नया प्रोजेक्ट शुरू करें।';
      speakText = 'Project creation cancel kar diya gaya hai.';
      chips = [
        { label: 'Naya Project Banayein', action: { type: 'set_intent', intent: 'create_project' } },
        { label: 'Main Menu', action: { type: 'reset' } },
      ];
    }

    return {
      success: true,
      status: 'cancelled',
      field: null,
      reply,
      speech,
      speakText,
      draft: currentDraft,
      missing: [],
      chips,
      candidates: [],
      notices: [],
      progress: { done: 0, total: 10 },
      intent: { type: 'cancel' },
      meta: { model: modelName },
    };
  }

  const wasAlreadyReady = (draft?.status === 'ready' || draft?.status === 'confirming');
  if (wasAlreadyReady && !actionHandled && trimmedMessage) {
    const isAffirmative = detectedIntent?.type === 'confirm_yes' || detectedIntent?.type === 'create_now';
    const isNegative = detectedIntent?.type === 'confirm_no';
    const isFieldEdit = hasExplicitFieldEditIntent(trimmedMessage);

    if (!isAffirmative && !isNegative && !isFieldEdit) {
      // Unrecognized noise in confirming state - do not mutate draft!
      const readyConfig = TASK_FIELDS.ready;
      let payload;
      let preview;
      if (currentDraft.intent === 'task_project') {
        payload = FORM_REGISTRY.task_project.buildPayload(currentDraft);
        preview = FORM_REGISTRY.task_project.buildPreview(currentDraft);
      } else if (currentDraft.assigneeId && currentDraft.taskFor === 'others') {
        payload = FORM_REGISTRY.task_assigned_user.buildPayload(currentDraft);
        preview = FORM_REGISTRY.task_assigned_user.buildPreview(currentDraft);
      } else {
        payload = FORM_REGISTRY.self_task.buildPayload(currentDraft);
        preview = FORM_REGISTRY.self_task.buildPreview(currentDraft);
      }

      return {
        success: true,
        status: 'ready',
        field: 'ready',
        reply: 'Samajh nahi aaya. Create kar doon? Haan ya nahi bolein, ya bataiye kya badalna hai.',
        speech: 'समझ नहीं आया। क्या बना दूं? हां या नहीं बोलें, या बताइए क्या बदलना है।',
        speakText: 'Samajh nahi aaya. Create kar doon? Haan ya nahi bolein.',
        draft: currentDraft,
        missing: [],
        chips: typeof readyConfig.chips === 'function' ? readyConfig.chips() : [],
        candidates: [],
        notices,
        progress: { done: 10, total: 10 },
        canAssignOthers,
        payload,
        preview,
        intent: { type: 'unrecognized_noise' },
        meta: { model: modelName },
      };
    }
  }

  if (!actionHandled && trimmedMessage) {
    const directNameChange = trimmedMessage.match(/(?:(?:project\s+)?(?:name|naam|title)\s*(?:badal\s*kar|change\s*karke|ko\s*badal\s*kar|rakh\s*kar)\s*([a-zA-Z0-9\s_.-]+?)(?:\s+(?:kar\s*do|kardo|rakho|karo))?$)/i);
    if (directNameChange && directNameChange[1] && !/^(?:badlo|badal|change|karo|do|kya|hai)$/i.test(directNameChange[1].trim())) {
      const newNameVal = directNameChange[1].trim();
      currentDraft.name = newNameVal;
      currentDraft.projectName = newNameVal;
      currentDraft.title = newNameVal;
      currentDraft.duplicateHandled = false;
      actionHandled = true;
    } else if (/\b(?:name|naam|title)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
      currentDraft.name = null;
      currentDraft.projectName = null;
      currentDraft.title = null;
      currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'name' && f !== 'title');
      actionHandled = true;
    } else if (/\b(?:dates?|tareekh|tarikh)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
      currentDraft.startDate = null;
      currentDraft.endDate = null;
      currentDraft.dueDateTime = null;
      currentDraft.dueDate = null;
      currentDraft.asked = (currentDraft.asked || []).filter(f => !['startDate', 'endDate', 'dueDate', 'dueDateTime'].includes(f));
      actionHandled = true;
    }

    // In-draft editing for create_project
    if (!actionHandled && currentDraft.intent === 'create_project') {
      const { extractCreateProjectSlotsFromMessage } = require('./projectSlotFiller');
      const pSlots = extractCreateProjectSlotsFromMessage(trimmedMessage, now);

      let projectFieldUpdated = false;

      // Status update: e.g. "ciis ai project ka status change karke active karo", "status active kardo", "status planning rakho"
      if (pSlots?.status || /\b(?:status|states)\b/i.test(trimmedMessage)) {
        if (pSlots?.status) {
          currentDraft.status = pSlots.status;
          projectFieldUpdated = true;
        } else if (/\b(?:active)\b/i.test(trimmedMessage)) {
          currentDraft.status = 'Active';
          projectFieldUpdated = true;
        } else if (/\b(?:planning|plan)\b/i.test(trimmedMessage)) {
          currentDraft.status = 'Planning';
          projectFieldUpdated = true;
        } else if (/\b(?:on\s*hold|hold)\b/i.test(trimmedMessage)) {
          currentDraft.status = 'On Hold';
          projectFieldUpdated = true;
        } else if (/\b(?:completed?|done|khatam)\b/i.test(trimmedMessage)) {
          currentDraft.status = 'Completed';
          projectFieldUpdated = true;
        } else if (/\b(?:cancelled?|radd)\b/i.test(trimmedMessage)) {
          currentDraft.status = 'Cancelled';
          projectFieldUpdated = true;
        } else if (/\b(?:status|states)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
          currentDraft.status = null;
          currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'status');
          actionHandled = true;
        }
      }

      // Priority update: e.g. "priority high kardo", "priority badal kar medium karo"
      if (pSlots?.priority || /\b(?:priority)\b/i.test(trimmedMessage)) {
        if (pSlots?.priority) {
          currentDraft.priority = pSlots.priority;
          projectFieldUpdated = true;
        } else if (/\b(?:high|urgent|zaroori)\b/i.test(trimmedMessage)) {
          currentDraft.priority = 'High';
          projectFieldUpdated = true;
        } else if (/\b(?:medium|normal)\b/i.test(trimmedMessage)) {
          currentDraft.priority = 'Medium';
          projectFieldUpdated = true;
        } else if (/\b(?:low|kam)\b/i.test(trimmedMessage)) {
          currentDraft.priority = 'Low';
          projectFieldUpdated = true;
        } else if (/\b(?:priority)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
          currentDraft.priority = null;
          currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'priority');
          actionHandled = true;
        }
      }

      // Dates update
      if (pSlots?.startDate) {
        currentDraft.startDate = pSlots.startDate;
        projectFieldUpdated = true;
      }
      if (pSlots?.endDate) {
        currentDraft.endDate = pSlots.endDate;
        projectFieldUpdated = true;
      }

      // Name update: e.g. "project name xyz kardo", "naam badal kar xyz karo"
      const nameUpdateMatch = trimmedMessage.match(/(?:(?:project\s+)?(?:naam|name)\s*(?:badal\s*kar|change\s*karke|badlo|badal|change)?\s*(?:karo|kar\s*do|rakho|is)?\s*[:=]?\s*([a-zA-Z0-9\s_-]+))/i);
      if (nameUpdateMatch && nameUpdateMatch[1] && !/^(?:badlo|badal|change|karo|do|kya|hai)$/i.test(nameUpdateMatch[1].trim())) {
        const newProjName = nameUpdateMatch[1].trim();
        if (newProjName && newProjName !== currentDraft.name) {
          currentDraft.name = newProjName;
          currentDraft.duplicateHandled = false;
          projectFieldUpdated = true;
        }
      }

      if (projectFieldUpdated) {
        actionHandled = true;
      }
    }

    
    // Answering create_client_plan fields
    if (!actionHandled && currentDraft.intent === 'create_client_plan') {
      if (lastAskedField === 'name' && !currentDraft.name) {
        currentDraft.name = trimmedMessage;
        if (!currentDraft.asked.includes('name')) currentDraft.asked.push('name');
        actionHandled = true;
      } else if (lastAskedField === 'price' && (currentDraft.price === null || currentDraft.price === undefined)) {
        if (/free/i.test(trimmedMessage)) {
          currentDraft.price = 0;
        } else {
          const num = trimmedMessage.match(/\d+/);
          currentDraft.price = num ? Number(num[0]) : 0;
        }
        if (!currentDraft.asked.includes('price')) currentDraft.asked.push('price');
        actionHandled = true;
      } else if (lastAskedField === 'months' && !currentDraft.months) {
        const num = trimmedMessage.match(/\d+/);
        currentDraft.months = num ? Number(num[0]) : 1;
        if (!currentDraft.asked.includes('months')) currentDraft.asked.push('months');
        actionHandled = true;
      } else if (lastAskedField === 'status' && !currentDraft.status) {
        currentDraft.status = /inactive/i.test(trimmedMessage) ? 'Inactive' : 'Active';
        if (!currentDraft.asked.includes('status')) currentDraft.asked.push('status');
        actionHandled = true;
      } else if (lastAskedField === 'description' && !currentDraft.descriptionDone) {
        if (isSkip(trimmedMessage) || /^(?:skip|koi\s*na?hi?|koi\s*nhi|koini|koinhi|none|chhod\s*do|chhodo|rehne\s*do|no|na)(?:\s*(?:\/|\-)?\s*skip)?$/i.test(trimmedMessage.trim())) {
          currentDraft.description = '';
          currentDraft.descriptionSkipped = true;
        } else {
          currentDraft.description = trimmedMessage;
        }
        currentDraft.descriptionDone = true;
        if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
        actionHandled = true;
      } else if (lastAskedField === 'services' && !currentDraft.servicesDone) {
        if (/^(?:done|bas|theek\s*hai|ho\s*gaya|ok)$/i.test(trimmedMessage)) {
          currentDraft.servicesDone = true;
          if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
          actionHandled = true;
        } else {
          const compServices = Array.isArray(deps.services) ? deps.services : (scope?.services || ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development']);
          const matched = compServices.filter(s => trimmedMessage.toLowerCase().includes(s.toLowerCase()));
          if (matched.length > 0) {
            currentDraft.services = Array.from(new Set([...(currentDraft.services || []), ...matched]));
            actionHandled = true;
          }
        }
      } else if (lastAskedField === 'serviceTasks' && !currentDraft.serviceTasksDone) {
        if (isSkip(trimmedMessage) || /^(?:nahi|no|na|skip|done|bas|aage\s*badh(?:o|ein)|ho\s*gaya|ok|rehne\s*do|chhod\s*do)(?:[,\s]+.*)?$/i.test(trimmedMessage.trim())) {
          currentDraft.addingServiceTasks = false;
          currentDraft.activeTaskService = null;
          currentDraft.serviceTasksDone = true;
          currentDraft.serviceTasksSkipped = true;
          if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
          actionHandled = true;
        } else if (/^(?:haan|ha|haa|yes|hanji|sure|add\s*karo|task\s*add|karna\s*hai)(?:[,\s]+.*)?$/i.test(trimmedMessage.trim()) || /(?:task\s*add|add\s*task)/i.test(trimmedMessage.trim())) {
          currentDraft.addingServiceTasks = true;
          actionHandled = true;
        } else if (currentDraft.activeTaskService) {
          const sName = currentDraft.activeTaskService;
          const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
          const tName = cleanName || trimmedMessage;
          if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
          if (!Array.isArray(currentDraft.serviceTasks[sName])) currentDraft.serviceTasks[sName] = [];
          currentDraft.serviceTasks[sName].push({
            name: tName,
            description: '',
            priority: 'Medium',
            dueInDays: 30
          });
          if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
          currentDraft.customTasks.push({
            service: sName,
            name: tName,
            description: '',
            priority: 'Medium',
            dueInDays: 30
          });
          currentDraft.lastAddedService = sName;
          currentDraft.activeTaskService = null;
          ackPrefix = `"${tName}" task "${sName}" mein add ho gaya. `;
          actionHandled = true;
        } else {
          const selServices = Array.isArray(currentDraft.services) ? currentDraft.services.map(s => typeof s === 'string' ? s : (s.service || s.name)) : [];
          const matchedService = selServices.find(s => trimmedMessage.toLowerCase().includes(s.toLowerCase()));
          if (matchedService) {
            let taskTitle = trimmedMessage.replace(new RegExp(matchedService, 'i'), '').replace(/\b(?:mein|mai|in|ke\s*liye|task|add|karo|banao)\b/gi, '').replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
            if (!taskTitle) {
              currentDraft.addingServiceTasks = true;
              currentDraft.activeTaskService = matchedService;
              currentDraft.lastAddedService = null;
              actionHandled = true;
            } else {
              if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
              if (!Array.isArray(currentDraft.serviceTasks[matchedService])) currentDraft.serviceTasks[matchedService] = [];
              currentDraft.serviceTasks[matchedService].push({
                name: taskTitle,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
              currentDraft.customTasks.push({
                service: matchedService,
                name: taskTitle,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              currentDraft.lastAddedService = matchedService;
              currentDraft.activeTaskService = null;
              ackPrefix = `"${taskTitle}" task "${matchedService}" mein add ho gaya. `;
              actionHandled = true;
            }
          } else if (currentDraft.lastAddedService && !/\b(?:kisi\s*aur|dusri|doosri|other)\b/i.test(trimmedMessage)) {
            const sName = currentDraft.lastAddedService;
            const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
            const tName = cleanName || trimmedMessage;
            if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
            if (!Array.isArray(currentDraft.serviceTasks[sName])) currentDraft.serviceTasks[sName] = [];
            currentDraft.serviceTasks[sName].push({
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
            currentDraft.customTasks.push({
              service: sName,
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            currentDraft.lastAddedService = sName;
            currentDraft.activeTaskService = null;
            ackPrefix = `"${tName}" task "${sName}" mein add ho gaya. `;
            actionHandled = true;
          } else if (/\b(?:kisi\s*aur|dusri|doosri|other|change)\b/i.test(trimmedMessage)) {
            currentDraft.addingServiceTasks = true;
            currentDraft.activeTaskService = null;
            currentDraft.lastAddedService = null;
            actionHandled = true;
          } else if (selServices.length === 1) {
            const singleSvc = selServices[0];
            const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
            const tName = cleanName || trimmedMessage;
            if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
            if (!Array.isArray(currentDraft.serviceTasks[singleSvc])) currentDraft.serviceTasks[singleSvc] = [];
            currentDraft.serviceTasks[singleSvc].push({
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
            currentDraft.customTasks.push({
              service: singleSvc,
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            currentDraft.lastAddedService = singleSvc;
            currentDraft.activeTaskService = null;
            ackPrefix = `"${tName}" task "${singleSvc}" mein add ho gaya. `;
            actionHandled = true;
          }
        }
      }
    }

    // 2a. Deterministic self words check (NO LLM, FREE)
    if (isSelfPhrase(trimmedMessage)) {
      currentDraft.taskFor = 'self';
      currentDraft.wantsOthers = false;
      currentDraft.assigneeId = null;
      currentDraft.assigneeName = null;
      currentDraft.assigneeLabel = null;
      if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
      if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');

      // If message was purely a self phrase, mark handled so it won't become a task title
      const cleanSelf = trimmedMessage.replace(/[.,!?;:]/g, '').trim().toLowerCase();
      const pureSelfTokens = ['khud ke liye', 'apne liye', 'mere liye', 'mujhe', 'self', 'me', 'myself', 'for me', 'खुद के लिए', 'अपने लिए', 'मेरे लिए', 'मैं'];
      if (pureSelfTokens.includes(cleanSelf)) {
        actionHandled = true;
      }
    }

    // 2a-2. Answering person confirmation from action title question ("Priya ko assign karna hai?")
    if (!actionHandled && (lastAskedField === 'assigneeConfirmation' || currentDraft.titlePersonCandidate)) {
      const isNo = /^(?:nahi|no|title\s+mein\s+hi\s+hai|title\s+mein\s+hai|nahi\s+title|rehne\s+do|khud\s+ka\s+hai|khud\s+ke\s+liye|khud\s+hi)\b/i.test(trimmedMessage);
      const isYes = /^(?:haan|ha|yes|assign\s+karo|assign\s+kar\s+do|kar\s+do|kardo|haan\s+assign)\b/i.test(trimmedMessage);
      if (isNo) {
        currentDraft.titlePersonHandled = true;
        currentDraft.titlePersonCandidate = null;
        actionHandled = true;
      } else if (isYes && (currentDraft.titlePersonCandidate || currentDraft.assigneeName)) {
        const pName = currentDraft.titlePersonCandidate || currentDraft.assigneeName;
        currentDraft.titlePersonHandled = true;
        currentDraft.taskFor = 'others';
        currentDraft.wantsOthers = true;
        currentDraft.intent = 'task_assigned_user';
        currentDraft.assigneeName = pName;
        currentDraft.titlePersonCandidate = null;
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        actionHandled = true;
      }
    }

    // 2a-3. Date Question Isolation: Answering a date question is parsed ONLY as a date.
    // Never pass it to the member/assignee parser!
    if (!actionHandled && (lastAskedField === 'startDate' || lastAskedField === 'endDate')) {
      const isDateSkip = isSkip(trimmedMessage) || isSkipAll(trimmedMessage);
      const isStart = lastAskedField === 'startDate';

      if (isDateSkip) {
        // Date is required in create_project, so skip is refused
        return {
          success: true,
          status: 'needs_input',
          field: lastAskedField,
          reply: isStart
            ? 'Project ki start date zaroori hai, isko skip nahi kar sakte. Kripya start date batayein (jaise: "03-11-2026" ya "kal se"):'
            : 'Project ki end date zaroori hai, isko skip nahi kar sakte. Kripya end date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
          speech: isStart
            ? 'प्रोजेक्ट की स्टार्ट डेट ज़रूरी है। कृपया स्टार्ट डेट बताएं।'
            : 'प्रोजेक्ट की एंड डेट ज़रूरी है। कृपया एंड डेट बताएं।',
          speakText: isStart
            ? 'Project ki start date zaroori hai. Kripya start date batayein.'
            : 'Project ki end date zaroori hai. Kripya end date batayein.',
          draft: currentDraft,
          missing: [lastAskedField],
          chips: isStart
            ? [
                { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: formatIstDate(now) } },
                { label: 'Kal se', action: { type: 'set', field: 'startDate', value: formatIstDate(new Date(now.getTime() + 86400000)) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ]
            : [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: isStart ? 2 : 3, total: 6 },
          payload: null,
          preview: null,
          intent: null,
          meta: { model: modelName },
        };
      }

      const parsedDate = parseProjectDate(trimmedMessage, now);
      if (parsedDate) {
        if (isStart) {
          currentDraft.startDate = parsedDate;
          actionHandled = true;
        } else {
          // endDate
          if (currentDraft.startDate && parsedDate < currentDraft.startDate) {
            notices.push('End date start date se pehle nahi ho sakti. Kripya valid end date batayein.');
            currentDraft.endDate = null;
            return {
              success: true,
              status: 'needs_input',
              field: 'endDate',
              reply: 'End date start date se pehle nahi ho sakti. Kripya valid end date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
              speech: 'एंड डेट स्टार्ट डेट से पहले नहीं हो सकती। कृपया सही एंड डेट बताएं।',
              speakText: 'End date start date se pehle nahi ho sakti. Kripya valid end date batayein.',
              draft: currentDraft,
              missing: ['endDate'],
              chips: [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 3, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          } else {
            currentDraft.endDate = parsedDate;
            actionHandled = true;
          }
        }
      } else {
        // Date could not be parsed: re-ask the same question with two example formats and chips
        return {
          success: true,
          status: 'needs_input',
          field: lastAskedField,
          reply: isStart
            ? 'Project kis date se shuru hoga? Kripya date batayein (jaise: "03-11-2026" ya "kal se"):'
            : 'Project kab tak complete hona chahiye? Kripya date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
          speech: isStart
            ? 'प्रोजेक्ट किस तारीख से शुरू होगा? कृपया तारीख बताएं जैसे 03-11-2026 या कल से।'
            : 'प्रोजेक्ट कब तक पूरा होना चाहिए? कृपया तारीख बताएं जैसे 30-11-2026 या एक महीने बाद।',
          speakText: isStart
            ? 'Project kis date se shuru hoga? Kripya date batayein jaise 03-11-2026 ya kal se.'
            : 'Project kab tak complete hona chahiye? Kripya date batayein jaise 30-11-2026 ya ek mahine baad.',
          draft: currentDraft,
          missing: [lastAskedField],
          chips: isStart
            ? [
                { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: formatIstDate(now) } },
                { label: 'Kal se', action: { type: 'set', field: 'startDate', value: formatIstDate(new Date(now.getTime() + 86400000)) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ]
            : [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: isStart ? 2 : 3, total: 6 },
          payload: null,
          preview: null,
          intent: null,
          meta: { model: modelName },
        };
      }
    }

    // 2b. Check if message mentions assignee(s) or contains edit commands (add/remove)
    const multiAssigneeResult = extractMultipleAssignees(trimmedMessage);
    const { names: mentionedNames, editAction } = multiAssigneeResult;

    if (editAction && canAssignOthers && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan' && currentDraft.intent !== 'create_client_plan') {
      if (editAction.type === 'remove') {
        removeLedgerEntry(currentDraft, { name: editAction.name });
        notices.push(`"${editAction.name}" ko task se hata diya gaya hai.`);
        actionHandled = true;
      } else if (editAction.type === 'add') {
        currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [editAction.name]);
        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
        if (currentDraft.intent !== 'task_project') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.intent = 'task_assigned_user';
          currentDraft.assigneeDone = true;
        }
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        actionHandled = true;
      }
    } else if (mentionedNames && mentionedNames.length > 0 && canAssignOthers && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan') {
      const isAnsweringOtherSlot = lastAskedField && lastAskedField !== 'assignee' && lastAskedField !== 'welcome' && ['title', 'description', 'dueDate', 'dueDateTime', 'priority', 'status', 'checkpoints', 'attachments'].includes(lastAskedField);
      if (!isAnsweringOtherSlot) {
        currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, mentionedNames);
        syncAssigneeLedgerDerivedFields(currentDraft);
        if (currentDraft.intent !== 'task_project') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.intent = 'task_assigned_user';
        }
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
      }
    } else if (!mentionedNames?.length && lastAskedField === 'assignee' && canAssignOthers && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan' && !actionHandled) {
      const cleanCandidate = cleanAssigneeName(trimmedMessage);
      const isNegative = detectedIntent?.type === 'cancel' || detectedIntent?.type === 'confirm_no';
      if (cleanCandidate && isValidAssigneeCandidate(cleanCandidate) && !isNegative && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage)) {
        currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [cleanCandidate]);
        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
        if (currentDraft.intent !== 'task_project') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.intent = 'task_assigned_user';
        }
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
      }
    }

    // 2c-project. Direct answering for create_project slots
    if (currentDraft.intent === 'create_project' && !actionHandled) {
      if (lastAskedField === 'name' && trimmedMessage && !isSkip(trimmedMessage)) {
        currentDraft.name = trimmedMessage;
        currentDraft.duplicateHandled = false;
        actionHandled = true;
      } else if (lastAskedField === 'description' && trimmedMessage && !isSkip(trimmedMessage)) {
        currentDraft.description = trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'startDate' && trimmedMessage && !isSkip(trimmedMessage)) {
        const parsed = parseProjectDate(trimmedMessage, now);
        currentDraft.startDate = parsed || trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'endDate' && trimmedMessage && !isSkip(trimmedMessage)) {
        const parsed = parseProjectDate(trimmedMessage, now);
        currentDraft.endDate = parsed || trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'members' && trimmedMessage) {
        if (/^(?:sirf\s+main|sirf\s+mai|main|mai|main\s+akela|akela|self|creator_only)/i.test(trimmedMessage)) {
          const creatorName = req?.user?.name || 'Aap';
          const creatorId = String(req?.user?._id || req?.user?.id || 'creator');
          currentDraft.members = [{ id: creatorId, name: creatorName, label: creatorName }];
          actionHandled = true;
        } else if (isSkip(trimmedMessage) || isSkipAll(trimmedMessage)) {
          return {
            success: true,
            status: 'needs_input',
            field: 'members',
            reply: 'Kam se kam ek team member zaroori hai, isko skip nahi kar sakte. Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)',
            speech: 'कम से कम एक टीम सदस्य जरूरी है। कृपया सदस्य बताएं या सिर्फ मैं चुनें।',
            speakText: 'Kam se kam ek team member zaroori hai. Project mein kaun kaun members honge?',
            draft: currentDraft,
            missing: ['members'],
            chips: [
              { label: 'Sirf main', action: { type: 'set', field: 'members', value: 'creator_only' } },
              { label: 'Cancel', action: { type: 'cancel' } },
            ],
            candidates: [],
            notices,
            canAssignOthers,
            progress: { done: 4, total: 6 },
            payload: null,
            preview: null,
            intent: null,
            meta: { model: modelName },
          };
        } else {
          const mExt = extractMultipleAssignees(trimmedMessage);
          const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (trimmedMessage.trim() ? [trimmedMessage.trim()] : []);
          if (mNames && mNames.length > 0) {
            currentDraft.assigneeName = trimmedMessage;
            currentDraft.assigneeLedger = createLedger(mNames);
            if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'members');
          }
        }
      } else {
        const pSlots = extractCreateProjectSlotsFromMessage(trimmedMessage, now);
        if (pSlots.name && !currentDraft.name) currentDraft.name = pSlots.name;
        if (pSlots.priority) currentDraft.priority = pSlots.priority;
        if (pSlots.status) currentDraft.status = pSlots.status;
        if (pSlots.startDate && !currentDraft.startDate) currentDraft.startDate = pSlots.startDate;
        if (pSlots.endDate && !currentDraft.endDate) currentDraft.endDate = pSlots.endDate;
        if (pSlots.membersText && (!currentDraft.members || currentDraft.members.length === 0)) {
          const mExt = extractMultipleAssignees(pSlots.membersText);
          const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (pSlots.membersText.trim() ? [pSlots.membersText.trim()] : []);
          if (mNames && mNames.length > 0) {
            currentDraft.assigneeName = pSlots.membersText;
            currentDraft.assigneeLedger = createLedger(mNames);
          }
        }
      }
    }

    // 2c-client. Direct answering for create_client slots
    if (currentDraft.intent === 'create_client' && !actionHandled) {
      const {
        extractCreateClientSlots,
        isValidEmail,
        isValidPhone,
        isValidGST,
        isValidPAN,
        isValidPincode,
        cleanPhone,
      } = require('./clientSlotFiller');

      // Edit commands for create_client
      if (/\b(?:email)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.email = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'email');
        actionHandled = true;
      } else if (/\bcity\s+([a-zA-Z\s_-]+?)\s*(?:karo|rakho|kar\s*do|set)\b/i.test(trimmedMessage)) {
        const cityMatch = trimmedMessage.match(/\bcity\s+([a-zA-Z\s_-]+?)\s*(?:karo|rakho|kar\s*do|set)\b/i);
        if (cityMatch && cityMatch[1]) {
          currentDraft.city = cityMatch[1].trim();
          actionHandled = true;
        }
      } else if (/\b(?:city)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.city = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'city');
        actionHandled = true;
      } else if (/\b(?:company)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.company = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'company');
        actionHandled = true;
      } else if (/\b(?:client|name|naam)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.client = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'client');
        actionHandled = true;
      }

      if (!actionHandled) {
        if (currentDraft.creatingManualPlan && currentDraft.manualPlan && trimmedMessage) {
          const mPlan = currentDraft.manualPlan;
          if (/\b(?:cancel|band\s*karo|hatao|chhod\s*do)\b/i.test(trimmedMessage)) {
            currentDraft.creatingManualPlan = false;
            currentDraft.manualPlan = null;
            actionHandled = true;
          } else if (mPlan.step === 'name') {
            mPlan.name = trimmedMessage.trim();
            mPlan.step = 'price';
            actionHandled = true;
          } else if (mPlan.step === 'price') {
            const numMatch = trimmedMessage.replace(/,/g, '').match(/\d+/);
            mPlan.price = numMatch ? Number(numMatch[0]) : 0;
            mPlan.step = 'months';
            actionHandled = true;
          } else if (mPlan.step === 'months') {
            const numMatch = trimmedMessage.match(/\d+/);
            mPlan.months = numMatch ? Number(numMatch[0]) : 1;
            mPlan.step = 'status';
            actionHandled = true;
          } else if (mPlan.step === 'status') {
            mPlan.status = /\b(?:inactive|band|off)\b/i.test(trimmedMessage) ? 'Inactive' : 'Active';
            mPlan.step = 'description';
            actionHandled = true;
          } else if (mPlan.step === 'description') {
            if (isSkip(trimmedMessage) || /^(?:skip|koi\s*nahi|nahi|chhod\s*do|no)\b/i.test(trimmedMessage)) {
              mPlan.description = '';
            } else {
              mPlan.description = trimmedMessage.trim();
            }
            mPlan.step = 'services';
            actionHandled = true;
          } else if (mPlan.step === 'services') {
            if (/^(?:done|ho\s*gaya|khatam|bas|save)\b/i.test(trimmedMessage)) {
              mPlan.step = 'ready';
              actionHandled = true;
            } else {
              let compServices = Array.isArray(deps.services) ? deps.services : [];
              if (compServices.length === 0) {
                compServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'];
              }
              const matched = compServices.filter(s => {
                const sName = typeof s === 'string' ? s : (s.servicename || s.name);
                return trimmedMessage.toLowerCase().includes(sName.toLowerCase());
              }).map(s => typeof s === 'string' ? s : (s.servicename || s.name));
              if (matched.length > 0) {
                mPlan.services = Array.from(new Set([...(mPlan.services || []), ...matched]));
              }
              actionHandled = true;
            }
          } else if (mPlan.step === 'ready') {
            if (/^(?:save|use|save\s*and\s*use|haan|yes|theek\s*hai|ok)\b/i.test(trimmedMessage)) {
              action = { type: 'save_and_use_plan' };
              actionHandled = false;
            }
          }
        } else if (lastAskedField === 'services' && trimmedMessage && !actionHandled) {
          if (isSkip(trimmedMessage) || /\b(?:abhi\s*nahi|skip|baad\s*mein|no)\b/i.test(trimmedMessage)) {
            if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
            actionHandled = true;
          } else if (/\b(?:ho\s*gaya|done|bas|theek\s*hai|next|aage|itna\s*hi|aur\s*nahi|koi\s*nahi|chalo)\b/i.test(trimmedMessage)) {
            currentDraft.servicesDone = true;
            if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
            actionHandled = true;
          } else {
            const parts = trimmedMessage.split(/\s*(?:,|\baur\b|\band\b)\s*/i)
              .map(s => s.trim())
              .filter(s => s.length > 0 && !/^(?:aur|and|services?|de\s*do|rakh\s*do)$/i.test(s));
            let compServices = [];
            if (scope.services && Array.isArray(scope.services)) {
              compServices = scope.services;
            } else if (deps.Service || mongoose.models.Service) {
              try {
                const docs = await (deps.Service || mongoose.models.Service).find({
                  ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
                }).select('servicename').lean();
                compServices = docs.map(d => d.servicename);
              } catch {}
            }
            if (compServices.length === 0) {
              compServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design'];
            }
            const newlyMatched = [];
            const invalidParts = [];
            parts.forEach(raw => {
              const matched = compServices.find(cs => {
                const csName = typeof cs === 'string' ? cs : (cs.servicename || cs.name || '');
                return csName.toLowerCase() === raw.toLowerCase();
              });
              if (matched) {
                const finalName = typeof matched === 'string' ? matched : (matched.servicename || matched.name);
                newlyMatched.push(finalName);
                currentDraft.services = Array.from(new Set([...(currentDraft.services || []), finalName]));
              } else {
                invalidParts.push(raw);
              }
            });

            if (newlyMatched.length === 0) {
              const unknownList = (invalidParts.length > 0 ? invalidParts : parts).join(', ');
              const invMsg = `"${unknownList}" hamari services mein nahi hai. Kripya neeche di gayi services mein se choose karein:`;
              const invSpeech = `Yeh hamari services mein nahi hai. Kripya neeche di gayi services mein se choose karein.`;
              const invHi = `यह हमारी Services में नहीं है। कृपया नीचे दी गई Services में से चुनें:`;
              const sChips = buildChips('create_client', 'services', { ...deps, services: compServices, draft: currentDraft });
              return {
                success: true,
                status: 'needs_input',
                field: 'services',
                reply: invMsg,
                speech: invSpeech,
                speakText: invMsg,
                speakTextHi: invHi,
                draft: currentDraft,
                missing: ['services'],
                chips: sChips,
                candidates: [],
                notices: [],
                canAssignOthers,
              };
            }

            if (newlyMatched.length > 0) {
              let msg = `"${newlyMatched.join(', ')}" service add ho gayi.`;
              if (invalidParts.length > 0) {
                msg = `"${invalidParts.join(', ')}" hamari services mein nahi hai. Lekin ${msg}`;
              }
              msg += `\n\nAur koi service add karni hai ya [Done] dabayein?`;
              const sChips = buildChips('create_client', 'services', { ...deps, services: compServices, draft: currentDraft });
              return {
                success: true,
                status: 'needs_input',
                field: 'services',
                reply: msg,
                speech: `${newlyMatched.join(', ')} service add ho gayi. Aur koi service add karni hai ya Done dabayein?`,
                speakText: msg,
                speakTextHi: `${newlyMatched.join(', ')} service add हो गई। और कोई service add करनी है या Ho gaya दबाएं?`,
                draft: currentDraft,
                missing: ['services'],
                chips: sChips,
                candidates: [],
                notices: [],
                canAssignOthers,
              };
            }
            actionHandled = true;
          }

        } else if (lastAskedField === 'clientPlan' && trimmedMessage && !actionHandled) {
          if (isSkip(trimmedMessage) || /\b(?:nahi|no|skip|chhod\s*do|bina|free)\b/i.test(trimmedMessage)) {
            currentDraft.clientPlanId = null;
            currentDraft.clientPlanName = null;
            currentDraft.clientPlanPrice = 0;
            currentDraft.clientPlanMonths = 0;
            currentDraft.clientPlanSkipped = true;
            currentDraft.clientPlanDone = true;
            currentDraft.allowedPlanServices = null;
            currentDraft.services = [];
            currentDraft.servicesDone = false;
            currentDraft.servicesSkipped = false;
            if (!currentDraft.asked.includes('clientPlan')) currentDraft.asked.push('clientPlan');
            actionHandled = true;
          } else if (/\b(?:manual|manually|naya|new\s*plan|create\s*plan)\b/i.test(trimmedMessage)) {
            currentDraft.creatingManualPlan = true;
            currentDraft.manualPlan = {
              name: '',
              price: null,
              months: 1,
              status: 'Active',
              description: '',
              services: [],
              step: 'name'
            };
            actionHandled = true;
          } else {
            const plans = Array.isArray(deps.clientPlans) ? deps.clientPlans : (Array.isArray(scope?.clientPlans) ? scope.clientPlans : []);
            const matchedPlan = plans.find(p => p.name && trimmedMessage.toLowerCase().includes(p.name.toLowerCase()));
            if (matchedPlan) {
              currentDraft.clientPlanId = String(matchedPlan._id || matchedPlan.id);
              currentDraft.clientPlanName = matchedPlan.name;
              currentDraft.clientPlanPrice = matchedPlan.price;
              currentDraft.clientPlanMonths = matchedPlan.months || 1;
              const pServices = Array.isArray(matchedPlan.services) ? matchedPlan.services.map(s => typeof s === 'string' ? s : (s.service || s.name || s.servicename)).filter(Boolean) : [];
              currentDraft.allowedPlanServices = pServices;
              currentDraft.services = [...pServices];
            } else {
              currentDraft.clientPlanName = trimmedMessage;
              currentDraft.clientPlanId = trimmedMessage;
            }
            currentDraft.clientPlanDone = true;
            currentDraft.clientPlanSkipped = false;
            currentDraft.servicesDone = true;
            currentDraft.servicesSkipped = false;
            currentDraft.serviceTasksDone = true;
            currentDraft.serviceTasksSkipped = true;
            if (!currentDraft.asked.includes('clientPlan')) currentDraft.asked.push('clientPlan');
            if (!currentDraft.asked.includes('services')) currentDraft.asked.push('services');
            if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
            actionHandled = true;
          }
        } else if (lastAskedField === 'serviceTasks' && trimmedMessage && !actionHandled) {
          if (isSkip(trimmedMessage) || /^(?:nahi|no|na|skip|done|bas|aage\s*badh(?:o|ein)|ho\s*gaya|ok|rehne\s*do|chhod\s*do)(?:[,\s]+.*)?$/i.test(trimmedMessage.trim())) {
            currentDraft.addingServiceTasks = false;
            currentDraft.activeTaskService = null;
            currentDraft.serviceTasksDone = true;
            currentDraft.serviceTasksSkipped = true;
            if (!currentDraft.asked.includes('serviceTasks')) currentDraft.asked.push('serviceTasks');
            actionHandled = true;
          } else if (/^(?:haan|ha|haa|yes|hanji|sure|add\s*karo|task\s*add|karna\s*hai)(?:[,\s]+.*)?$/i.test(trimmedMessage.trim()) || /(?:task\s*add|add\s*task)/i.test(trimmedMessage.trim())) {
            currentDraft.addingServiceTasks = true;
            actionHandled = true;
          } else if (currentDraft.activeTaskService) {
            const sName = currentDraft.activeTaskService;
            const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
            const tName = cleanName || trimmedMessage;
            if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
            if (!Array.isArray(currentDraft.serviceTasks[sName])) currentDraft.serviceTasks[sName] = [];
            currentDraft.serviceTasks[sName].push({
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
            currentDraft.customTasks.push({
              service: sName,
              name: tName,
              description: '',
              priority: 'Medium',
              dueInDays: 30
            });
            currentDraft.lastAddedService = sName;
            currentDraft.activeTaskService = null;
            ackPrefix = `"${tName}" task "${sName}" mein add ho gaya. `;
            actionHandled = true;
          } else {
            const selServices = Array.isArray(currentDraft.services) ? currentDraft.services.map(s => typeof s === 'string' ? s : (s.service || s.name)) : [];
            const matchedService = selServices.find(s => trimmedMessage.toLowerCase().includes(s.toLowerCase()));
            if (matchedService) {
              let taskTitle = trimmedMessage.replace(new RegExp(matchedService, 'i'), '').replace(/\b(?:mein|mai|in|ke\s*liye|task|add|karo|banao)\b/gi, '').replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
              if (!taskTitle) {
                currentDraft.addingServiceTasks = true;
                currentDraft.activeTaskService = matchedService;
                currentDraft.lastAddedService = null;
                actionHandled = true;
              } else {
                if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
                if (!Array.isArray(currentDraft.serviceTasks[matchedService])) currentDraft.serviceTasks[matchedService] = [];
                currentDraft.serviceTasks[matchedService].push({
                  name: taskTitle,
                  description: '',
                  priority: 'Medium',
                  dueInDays: 30
                });
                if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
                currentDraft.customTasks.push({
                  service: matchedService,
                  name: taskTitle,
                  description: '',
                  priority: 'Medium',
                  dueInDays: 30
                });
                currentDraft.lastAddedService = matchedService;
                currentDraft.activeTaskService = null;
                ackPrefix = `"${taskTitle}" task "${matchedService}" mein add ho gaya. `;
                actionHandled = true;
              }
            } else if (currentDraft.lastAddedService && !/\b(?:kisi\s*aur|dusri|doosri|other)\b/i.test(trimmedMessage)) {
              const sName = currentDraft.lastAddedService;
              const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
              const tName = cleanName || trimmedMessage;
              if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
              if (!Array.isArray(currentDraft.serviceTasks[sName])) currentDraft.serviceTasks[sName] = [];
              currentDraft.serviceTasks[sName].push({
                name: tName,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
              currentDraft.customTasks.push({
                service: sName,
                name: tName,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              currentDraft.lastAddedService = sName;
              currentDraft.activeTaskService = null;
              ackPrefix = `"${tName}" task "${sName}" mein add ho gaya. `;
              actionHandled = true;
            } else if (/\b(?:kisi\s*aur|dusri|doosri|other|change)\b/i.test(trimmedMessage)) {
              currentDraft.addingServiceTasks = true;
              currentDraft.activeTaskService = null;
              currentDraft.lastAddedService = null;
              actionHandled = true;
            } else if (selServices.length === 1) {
              const singleSvc = selServices[0];
              const cleanName = trimmedMessage.replace(/^(?:task\s*ka\s*naam|task\s*title|task\s*name|task)\s*[:=\-]?\s*/i, '').trim();
              const tName = cleanName || trimmedMessage;
              if (!currentDraft.serviceTasks) currentDraft.serviceTasks = {};
              if (!Array.isArray(currentDraft.serviceTasks[singleSvc])) currentDraft.serviceTasks[singleSvc] = [];
              currentDraft.serviceTasks[singleSvc].push({
                name: tName,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              if (!Array.isArray(currentDraft.customTasks)) currentDraft.customTasks = [];
              currentDraft.customTasks.push({
                service: singleSvc,
                name: tName,
                description: '',
                priority: 'Medium',
                dueInDays: 30
              });
              currentDraft.lastAddedService = singleSvc;
              currentDraft.activeTaskService = null;
              ackPrefix = `"${tName}" task "${singleSvc}" mein add ho gaya. `;
              actionHandled = true;
            }
          }
        } else if (lastAskedField === 'subscriptionStartDate' && trimmedMessage && !actionHandled) {
          const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('./clientSlotFiller');
          const parsed = parseRelativeOrAbsoluteDate(trimmedMessage);
          if (parsed) {
            currentDraft.subscriptionStartDate = parsed;
            if (currentDraft.clientPlanMonths) {
              currentDraft.subscriptionEndDate = calculateEndDate(parsed, currentDraft.clientPlanMonths);
            }
            if (!currentDraft.asked.includes('subscriptionStartDate')) currentDraft.asked.push('subscriptionStartDate');
            actionHandled = true;
          }
        } else         if (lastAskedField === 'client' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.client = trimmedMessage;
          currentDraft.duplicateHandled = false;
          actionHandled = true;
        } else if (lastAskedField === 'company' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.company = trimmedMessage;
          currentDraft.duplicateHandled = false;
          actionHandled = true;
        } else if (lastAskedField === 'city' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.city = trimmedMessage;
          actionHandled = true;
        } else if (lastAskedField === 'email' && trimmedMessage && !actionHandled) {
          if (isSkip(trimmedMessage) || /^(?:skip|chhod\s*do|nahi|no|baad\s*mein)\b/i.test(trimmedMessage)) {
            return {
              success: true,
              status: 'needs_input',
              field: 'email',
              reply: 'Client ka email address zaroori hai, isko skip nahi kar sakte. Kripya valid email address batayein (jaise: client@example.com):',
              speech: 'Client ka email address zaroori hai. Kripya valid email batayein.',
              speakText: 'Client ka email address zaroori hai, isko skip nahi kar sakte. Kripya valid email address batayein:',
              speakTextHi: 'Client का email address जरूरी है। कृपया valid email बताएं:',
              draft: currentDraft,
              missing: ['email'],
              chips: [{ label: 'Cancel', action: { type: 'cancel' } }],
              candidates: [],
              notices: [],
              canAssignOthers,
            };
          }
          const emailMatch = trimmedMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const candidateEmail = emailMatch ? emailMatch[0] : trimmedMessage.trim();
          if (isValidEmail(candidateEmail)) {
            currentDraft.email = candidateEmail.toLowerCase();
            if (!currentDraft.asked.includes('email')) currentDraft.asked.push('email');
            actionHandled = true;
          } else {
            return {
              success: true,
              status: 'needs_input',
              field: 'email',
              reply: 'Email format galat hai. Kripya valid email address batayein (jaise: client@example.com):',
              speech: 'Email format galat hai. Kripya valid email batayein.',
              speakText: 'Email format galat hai. Kripya valid email address batayein:',
              speakTextHi: 'Email format गलत है। कृपया valid email बताएं:',
              draft: currentDraft,
              missing: ['email'],
              chips: [{ label: 'Cancel', action: { type: 'cancel' } }],
              candidates: [],
              notices: [],
              canAssignOthers,
            };
          }
        } else if (lastAskedField === 'status' && trimmedMessage && currentDraft.intent === 'create_client' && !actionHandled) {
          if (isSkip(trimmedMessage)) {
            currentDraft.status = 'Active';
          } else if (/\b(?:on\s*hold|hold)\b/i.test(trimmedMessage)) {
            currentDraft.status = 'On Hold';
          } else if (/\b(?:inactive|band)\b/i.test(trimmedMessage)) {
            currentDraft.status = 'Inactive';
          } else {
            currentDraft.status = 'Active';
          }
          if (!currentDraft.asked.includes('status')) currentDraft.asked.push('status');
          actionHandled = true;
        } else if ((lastAskedField === 'projectManager' || lastAskedField === 'team') && trimmedMessage) {
          if (isSkip(trimmedMessage) || isSkipAll(trimmedMessage)) {
            return {
              success: true,
              status: 'needs_input',
              field: 'projectManager',
              reply: 'Kam se kam ek team member chunna zaroori hai, isko skip nahi kar sakte. Kripya team member ka naam batayein:',
              speech: 'कम से कम एक टीम सदस्य चुनना जरूरी है।',
              speakText: 'Kam se kam ek team member chunna zaroori hai. Kripya team member ka naam batayein:',
              draft: currentDraft,
              missing: ['projectManager'],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 3, total: 4 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          } else {
            const mExt = extractMultipleAssignees(trimmedMessage);
            const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (trimmedMessage.trim() ? [trimmedMessage.trim()] : []);
            if (mNames && mNames.length > 0) {
              currentDraft.assigneeName = trimmedMessage;
              currentDraft.assigneeLedger = createLedger(mNames);
              currentDraft.teamDone = true;
              if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
            }
          }
        } else if (lastAskedField === 'more_details' || currentDraft.activeDetailsGroup) {
          const isFinishDetailsMsg = /^(?:nahi[\s,]*bas|bas|nahi|nahin|nahin[\s,]*bas|koi\s*nahi|done|khatam|no|नहीं[\s,]*बस|बस|नहीं|कोई\s*नहीं|हो\s*गया)$/i.test(trimmedMessage);
          if (isFinishDetailsMsg) {
            currentDraft.moreDetailsDone = true;
            currentDraft.activeDetailsGroup = null;
            currentDraft.activeGroupField = null;
            actionHandled = true;
          } else if (!currentDraft.activeDetailsGroup && /\b(?:contact|sampark|सम्पर्क|संपर्क)\b/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'contact';
            currentDraft.activeGroupField = null;
            actionHandled = true;
          } else if (!currentDraft.activeDetailsGroup && /\b(?:business|vyapar|व्यापार|बिज़नेस|बिजनेस)\b/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'business';
            currentDraft.activeGroupField = null;
            actionHandled = true;
          } else if (!currentDraft.activeDetailsGroup && /\b(?:address|pata|पता|एड्रेस)\b/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'address';
            currentDraft.activeGroupField = null;
            actionHandled = true;
          } else if (!currentDraft.activeDetailsGroup && /\b(?:notes?|description|विवरण|नोट्स)\b/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'notes';
            currentDraft.activeGroupField = null;
            actionHandled = true;
          } else if (!currentDraft.activeDetailsGroup && /\b(?:logo|photo|image|picture|लोगो)\b/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'logo';
            currentDraft.activeGroupField = 'logo';
            actionHandled = true;
          } else if (currentDraft.activeDetailsGroup) {
            const group = currentDraft.activeDetailsGroup;
            const field = currentDraft.activeGroupField;
            if (/^(?:chhod\s*do|chhod|leave|khatam)/i.test(trimmedMessage)) {
              if (!Array.isArray(currentDraft.completedDetailsGroups)) currentDraft.completedDetailsGroups = [];
              if (!currentDraft.completedDetailsGroups.includes(group)) currentDraft.completedDetailsGroups.push(group);
              currentDraft.activeDetailsGroup = null;
              currentDraft.activeGroupField = null;
              actionHandled = true;
            } else if (/^(?:skip|skip\s*karo|chhod\s*do|next)/i.test(trimmedMessage)) {
              if (!Array.isArray(currentDraft.skippedDetailsFields)) currentDraft.skippedDetailsFields = [];
              if (field && !currentDraft.skippedDetailsFields.includes(field)) currentDraft.skippedDetailsFields.push(field);
              if (field === 'logo' || group === 'logo') {
                if (!Array.isArray(currentDraft.completedDetailsGroups)) currentDraft.completedDetailsGroups = [];
                if (!currentDraft.completedDetailsGroups.includes('logo')) currentDraft.completedDetailsGroups.push('logo');
                currentDraft.activeDetailsGroup = null;
                currentDraft.activeGroupField = null;
              }
              actionHandled = true;
            } else {
              const cSlots = extractCreateClientSlots(trimmedMessage);

              if (field === 'email' || cSlots.email) {
                const targetEmail = cSlots.email || (isValidEmail(trimmedMessage) ? trimmedMessage : null);
                if (targetEmail) {
                  if (isValidEmail(targetEmail)) currentDraft.email = targetEmail;
                  else notices.push('Email format galat hai. Udaharan: name@example.com.');
                }
              }
              if (field === 'phone' || cSlots.phone) {
                const rawPhone = cSlots.phone || cleanPhone(trimmedMessage);
                if (rawPhone && rawPhone.length === 10) {
                  if (isValidPhone(rawPhone)) currentDraft.phone = rawPhone;
                  else notices.push('Phone number 10 digits ka hona chahiye (udaharan: 9876543210).');
                } else if (field === 'phone') {
                  notices.push('Phone number 10 digits ka hona chahiye (udaharan: 9876543210).');
                }
              }
              if (field === 'industry' || cSlots.industry) {
                currentDraft.industry = cSlots.industry || trimmedMessage;
              }
              if (field === 'gst' || cSlots.gst) {
                const rawGst = cSlots.gst || trimmedMessage.trim();
                if (isValidGST(rawGst)) currentDraft.gst = rawGst.toUpperCase();
                else notices.push('GST format galat hai (udaharan: 22AAAAA0000A1Z5).');
              }
              if (field === 'pan' || cSlots.pan) {
                const rawPan = cSlots.pan || trimmedMessage.trim();
                if (isValidPAN(rawPan)) currentDraft.pan = rawPan.toUpperCase();
                else notices.push('PAN format galat hai (udaharan: ABCDE1234F).');
              }
              if (field === 'website' || cSlots.website) {
                currentDraft.website = cSlots.website || trimmedMessage;
              }
              if (field === 'address' || cSlots.address) {
                currentDraft.address = cSlots.address || trimmedMessage;
              }
              if (field === 'state' || cSlots.state) {
                currentDraft.state = cSlots.state || trimmedMessage;
              }
              if (field === 'country' || cSlots.country) {
                currentDraft.country = cSlots.country || trimmedMessage;
              }
              if (field === 'pincode' || cSlots.pincode) {
                const rawPin = cSlots.pincode || trimmedMessage.trim();
                if (isValidPincode(rawPin)) currentDraft.pincode = rawPin;
                else notices.push('Pincode 6 digits ka hona chahiye (udaharan: 110001).');
              }
              if (field === 'description' || cSlots.description) {
                currentDraft.description = cSlots.description || trimmedMessage;
              }
              if (field === 'notes' || cSlots.notes) {
                currentDraft.notes = cSlots.notes || trimmedMessage;
              }

              if (cSlots.client && !currentDraft.client) currentDraft.client = cSlots.client;
              if (cSlots.company && !currentDraft.company) currentDraft.company = cSlots.company;
              if (cSlots.city && !currentDraft.city) currentDraft.city = cSlots.city;

              actionHandled = true;
            }

            const groupFieldsMap = {
              contact: ['email', 'phone'],
              business: ['industry', 'gst', 'pan', 'website'],
              address: ['address', 'state', 'country', 'pincode'],
              notes: ['description', 'notes'],
            };
            const gFields = groupFieldsMap[group] || [];
            const skipped = Array.isArray(currentDraft.skippedDetailsFields) ? currentDraft.skippedDetailsFields : [];
            const remaining = gFields.filter(f => !currentDraft[f] && !skipped.includes(f));
            if (remaining.length === 0) {
              if (!Array.isArray(currentDraft.completedDetailsGroups)) currentDraft.completedDetailsGroups = [];
              if (!currentDraft.completedDetailsGroups.includes(group)) currentDraft.completedDetailsGroups.push(group);
              currentDraft.activeDetailsGroup = null;
              currentDraft.activeGroupField = null;
            }
          } else {
            const cSlots = extractCreateClientSlots(trimmedMessage);
            if (cSlots.email && isValidEmail(cSlots.email)) currentDraft.email = cSlots.email;
            if (cSlots.phone && isValidPhone(cSlots.phone)) currentDraft.phone = cleanPhone(cSlots.phone);
            if (cSlots.industry) currentDraft.industry = cSlots.industry;
            if (cSlots.gst && isValidGST(cSlots.gst)) currentDraft.gst = cSlots.gst.toUpperCase();
            if (cSlots.pan && isValidPAN(cSlots.pan)) currentDraft.pan = cSlots.pan.toUpperCase();
            if (cSlots.website) currentDraft.website = cSlots.website;
            if (cSlots.address) currentDraft.address = cSlots.address;
            if (cSlots.state) currentDraft.state = cSlots.state;
            if (cSlots.country) currentDraft.country = cSlots.country;
            if (cSlots.pincode && isValidPincode(cSlots.pincode)) currentDraft.pincode = cSlots.pincode;
            if (cSlots.description) currentDraft.description = cSlots.description;
            if (cSlots.notes) currentDraft.notes = cSlots.notes;
            actionHandled = true;
          }
        } else {
          // Conversational or one-shot input
          const cSlots = extractCreateClientSlots(trimmedMessage);
          if (cSlots.client && !currentDraft.client) currentDraft.client = cSlots.client;
          if (cSlots.company && !currentDraft.company) currentDraft.company = cSlots.company;
          if (cSlots.city && !currentDraft.city) currentDraft.city = cSlots.city;
          if (cSlots.email && !currentDraft.email) {
            if (isValidEmail(cSlots.email)) currentDraft.email = cSlots.email;
            else notices.push('Email format galat hai. Udaharan: name@example.com.');
          }
          if (cSlots.phone && !currentDraft.phone) {
            if (isValidPhone(cSlots.phone)) currentDraft.phone = cleanPhone(cSlots.phone);
            else notices.push('Phone number 10 digits ka hona chahiye (udaharan: 9876543210).');
          }
          if (cSlots.gst && !currentDraft.gst) {
            if (isValidGST(cSlots.gst)) currentDraft.gst = cSlots.gst.toUpperCase();
            else notices.push('GST format galat hai (udaharan: 22AAAAA0000A1Z5).');
          }
          if (cSlots.pan && !currentDraft.pan) {
            if (isValidPAN(cSlots.pan)) currentDraft.pan = cSlots.pan.toUpperCase();
            else notices.push('PAN format galat hai (udaharan: ABCDE1234F).');
          }
          if (cSlots.website && !currentDraft.website) currentDraft.website = cSlots.website;
          if (cSlots.address && !currentDraft.address) currentDraft.address = cSlots.address;
          if (cSlots.state && !currentDraft.state) currentDraft.state = cSlots.state;
          if (cSlots.pincode && !currentDraft.pincode) {
            if (isValidPincode(cSlots.pincode)) currentDraft.pincode = cSlots.pincode;
            else notices.push('Pincode 6 digits ka hona chahiye (udaharan: 110001).');
          }
          if (cSlots.industry && !currentDraft.industry) currentDraft.industry = cSlots.industry;
          if (cSlots.description && !currentDraft.description) currentDraft.description = cSlots.description;
          if (cSlots.notes && !currentDraft.notes) currentDraft.notes = cSlots.notes;
          if (cSlots.membersText && (!currentDraft.projectManager || currentDraft.projectManager.length === 0)) {
            const mExt = extractMultipleAssignees(cSlots.membersText);
            const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (cSlots.membersText.trim() ? [cSlots.membersText.trim()] : []);
            if (mNames && mNames.length > 0) {
              currentDraft.assigneeName = cSlots.membersText;
              currentDraft.assigneeLedger = createLedger(mNames);
            }
          }
        }
      }
    }

    // 2c. Intent & Extraction Handling
    if (!actionHandled) {
      const hasOtherFieldIntent = /(?:title|naam|नाम|description|विवरण|priority|प्रायोरिटी|status|स्टेटस|due|time|samay|समय|kal|कल|aaj|आज|tomorrow|today|tarikh|tareekh|तारीख|date|change|badal|badlo|बदलो)/i.test(trimmedMessage);

      // Direct answer to reminder question when reminder is pending
      if (!actionHandled && lastAskedField === 'reminder' && (currentDraft.reminder === null || currentDraft.reminder === undefined) && !hasOtherFieldIntent && !/\b(?:task|create|banao|submit)\b/i.test(trimmedMessage)) {
        const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
        const intervalMatch = cleanMsg.match(/(?:repeat\s+)?(?:every|har|repeat\s+every|har\s+ek|interval\s*of)\s*(\d+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
          cleanMsg.match(/(\d+)\s*(?:min(?:ute)?s?|m|मिनट)\s*(?:ka\s*)?(?:repeat\s*)?(?:reminder|interval)/i) ||
          cleanMsg.match(/^(\d+)\s*(?:min|minute|m)$/i);
        const beforeDueMatch = cleanMsg.match(/(?:due\s*(?:se|time\s*se)?\s*)?(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i) ||
          cleanMsg.match(/(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i);

        const isAffirmative = Boolean(intervalMatch || beforeDueMatch) ||
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां|haanji|hnji|sure|ok|okay|yep|true)$/iu.test(cleanMsg) ||
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां)(?:[\s]|$)/iu.test(cleanMsg) ||
          /(?:1|one|ek|hour|ghant|baad|pehle|before|half|30|aadha|hourly|har\s*ghant|एक|घंटे|घंटा|बाद|पहले)/iu.test(cleanMsg);
        const isNegative = /^(?:nahi|no|off|band|mat\s*lagao|nahi\s*chahiye|rehne\s*do|नहीं|ना|false)$/iu.test(cleanMsg) ||
          /^(?:nahi|no|off|mat\s*lagao)(?:[\s]|$)/iu.test(cleanMsg);

        if (isAffirmative) {
          currentDraft.reminder = true;
          if (intervalMatch) {
            currentDraft.repeatIntervalMinutes = parseInt(intervalMatch[1], 10);
            currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
          } else if (beforeDueMatch) {
            const qty = parseInt(beforeDueMatch[1], 10);
            const unit = beforeDueMatch[2].toLowerCase();
            const mins = /ghant|hour|घंट/.test(unit) ? qty * 60 : qty;
            currentDraft.minutesBeforeDue = mins;
            currentDraft.reminderOption = mins === 60 ? 'oneHourBefore' : 'beforeDue';
          } else if (/(?:half|30|aadha|आधा)/i.test(cleanMsg)) {
            currentDraft.reminderOption = 'halfHourly';
            currentDraft.repeatIntervalMinutes = 30;
          } else if (/(?:hourly|every|har\s*(?:1\s*)?ghant|har\s*ghante|हर\s*घंटे)/i.test(cleanMsg)) {
            currentDraft.reminderOption = 'hourly';
            currentDraft.repeatIntervalMinutes = 60;
          } else {
            currentDraft.reminderOption = currentDraft.reminderOption || 'oneHourBefore';
            currentDraft.minutesBeforeDue = null;
          }
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
          actionHandled = true;
        } else if (isNegative) {
          currentDraft.reminder = false;
          currentDraft.reminderOption = null;
          currentDraft.repeatIntervalMinutes = null;
          currentDraft.minutesBeforeDue = null;
          currentDraft.customTime = null;
          currentDraft.reminderTime = null;
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
          actionHandled = true;
        }
      }

      // Check if message is a pure intent (e.g. standalone "baaki sab default", "cancel", "submit")
      const hasFieldKeywords = /(?:title|naam|नाम|description|विवरण|डिस्क्रिप्शन|priority|प्रायोरिटी|status|स्टेटस|due|kal|कल|aaj|आज|tomorrow|today|baje|बजे|baaj|baj|bach|time|samay|समय|date|tareekh|tarikh|तारीख|minute|min|मिनट|hour|ghanta|घंटा|pm|am|reminder|रिमाइंडर|checkpoints|चेकपॉइंट|assign|photo|file)/i.test(trimmedMessage);
      const isPureIntent = !actionHandled && detectedIntent && ['skip_all', 'create_now', 'confirm_yes', 'confirm_no'].includes(detectedIntent.type) && !hasFieldKeywords;

      if (!actionHandled && isPureIntent && detectedIntent.type === 'skip_all') {
        const allOptional = currentDraft.intent === 'create_project'
          ? ['priority', 'status', 'pdfFile']
          : (currentDraft.intent === 'create_client'
            ? ['email', 'phone', 'industry', 'gst', 'pan', 'website', 'address', 'state', 'country', 'pincode', 'description', 'notes', 'more_details']
            : (currentDraft.intent === 'self_task'
              ? (currentDraft.description ? ['priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'] : ['priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'])
              : ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile']));
        if (currentDraft.intent === 'create_client') {
          currentDraft.moreDetailsDone = true;
        }
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
            if (fieldKey === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments' || fieldKey === 'file' || fieldKey === 'pdfFile') {
              currentDraft.attachmentsCount = 0;
              currentDraft.file = null;
              currentDraft.pdfFile = null;
            }
          }
        });
        actionHandled = true;
      } else if (!actionHandled && isPureIntent && (detectedIntent.type === 'create_now' || detectedIntent.type === 'confirm_yes')) {
        // If required fields are filled, skip optional fields and proceed
        if (currentDraft.title && currentDraft.dueDateTime && (currentDraft.intent !== 'self_task' || currentDraft.description)) {
          const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'];
          allOptional.forEach((f) => {
            if (currentDraft.intent === 'self_task' && f === 'description' && !currentDraft.description) return;
            if (!currentDraft.skipped.includes(f)) currentDraft.skipped.push(f);
          });
        }
        actionHandled = true;
      } else if (!actionHandled && isPureIntent && detectedIntent.type === 'confirm_no') {
        wantsEditPrompt = true;
        actionHandled = true;
      } else if (!actionHandled) {

        // Direct answer to reminderOption question
        if (!actionHandled && lastAskedField === 'reminderOption' && (currentDraft.reminderOption === null || currentDraft.reminderOption === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase();
          const intervalMatch = cleanMsg.match(/(?:repeat\s+)?(?:every|har|repeat\s+every|har\s+ek|interval\s*of)\s*(\d+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
            cleanMsg.match(/(\d+)\s*(?:min(?:ute)?s?|m|मिनट)\s*(?:ka\s*)?(?:repeat\s*)?(?:reminder|interval)/i) ||
            cleanMsg.match(/^(\d+)\s*(?:min|minute|m)$/i);
          const beforeDueMatch = cleanMsg.match(/(?:due\s*(?:se|time\s*se)?\s*)?(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i) ||
            cleanMsg.match(/(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i);

          if (intervalMatch) {
            currentDraft.reminder = true;
            currentDraft.repeatIntervalMinutes = parseInt(intervalMatch[1], 10);
            currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
            actionHandled = true;
          } else if (beforeDueMatch) {
            currentDraft.reminder = true;
            const qty = parseInt(beforeDueMatch[1], 10);
            const unit = beforeDueMatch[2].toLowerCase();
            const mins = /ghant|hour|घंट/.test(unit) ? qty * 60 : qty;
            currentDraft.minutesBeforeDue = mins;
            currentDraft.reminderOption = mins === 60 ? 'oneHourBefore' : 'beforeDue';
            actionHandled = true;
          } else if (cleanMsg.includes('half') || cleanMsg.includes('30') || cleanMsg.includes('aadha') || cleanMsg.includes('आधा')) {
            currentDraft.reminderOption = 'halfHourly';
            currentDraft.repeatIntervalMinutes = 30;
            currentDraft.reminder = true;
            actionHandled = true;
          } else if (cleanMsg.includes('every') || cleanMsg.includes('har 1') || cleanMsg.includes('hourly') || cleanMsg.includes('har ghante') || cleanMsg.includes('हर')) {
            currentDraft.reminderOption = 'hourly';
            currentDraft.repeatIntervalMinutes = 60;
            currentDraft.reminder = true;
            actionHandled = true;
          } else if (cleanMsg.includes('1') || cleanMsg.includes('one') || cleanMsg.includes('pehle') || cleanMsg.includes('before') || cleanMsg.includes('ek') || cleanMsg.includes('ghant') || cleanMsg.includes('baad') || cleanMsg.includes('hour') || cleanMsg.includes('एक') || cleanMsg.includes('घंटे') || cleanMsg.includes('घंटा') || cleanMsg.includes('बाद') || cleanMsg.includes('पहले')) {
            currentDraft.reminderOption = 'oneHourBefore';
            currentDraft.minutesBeforeDue = null;
            currentDraft.reminder = true;
            actionHandled = true;
          }
          if (actionHandled) {
            if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          }
        }

        // Direct answer to priority question
        if (!actionHandled && lastAskedField === 'priority' && (currentDraft.priority === null || currentDraft.priority === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
          if (['low', 'kam', 'halka', 'लो'].includes(cleanMsg)) {
            currentDraft.priority = 'low';
            actionHandled = true;
          } else if (['high', 'urgent', 'jaruri', 'zaroori', 'हाई', 'ज़रूरी'].includes(cleanMsg)) {
            currentDraft.priority = 'high';
            actionHandled = true;
          } else if (['medium', 'normal', 'theek', 'मीडियम'].includes(cleanMsg)) {
            currentDraft.priority = 'medium';
            actionHandled = true;
          }
          if (actionHandled) {
            if (!currentDraft.asked.includes('priority')) currentDraft.asked.push('priority');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priority');
          }
        }

        // Direct answer to status question
        if (!actionHandled && lastAskedField === 'status' && (currentDraft.status === null || currentDraft.status === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
          const parsedStatus = TASK_FIELDS.status?.parse ? TASK_FIELDS.status.parse(cleanMsg) : null;
          if (parsedStatus) {
            currentDraft.status = parsedStatus;
            actionHandled = true;
            if (!currentDraft.asked.includes('status')) currentDraft.asked.push('status');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'status');
          }
        }

        // Deterministic extraction runs first
        const detSlots = parseHinglishSlots(trimmedMessage, now, currentDraft.dueDateTime);

        if (!actionHandled && lastAskedField === 'title' && (isSkip(trimmedMessage) || isSkipAll(trimmedMessage))) {
          currentDraft.title = null;
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'title');
          actionHandled = true;
          return {
            success: true,
            status: 'needs_input',
            field: 'title',
            reply: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
            speech: 'टास्क का नाम ज़रूरी है, इसको स्किप नहीं कर सकते। कृपया टास्क का नाम बताएं।',
            speakText: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
            draft: currentDraft,
            missing: ['title'],
            chips: [],
            candidates: [],
            notices,
            canAssignOthers,
            progress: { done: 0, total: 10 },
            payload: null,
            preview: null,
            intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
            meta: { model: modelName },
          };
        }

        if (!actionHandled && lastAskedField === 'description' && currentDraft.intent === 'self_task' && (isSkip(trimmedMessage) || isSkipAll(trimmedMessage))) {
          currentDraft.description = null;
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'description');
          actionHandled = true;
          const isEnTurn = (userLang === 'en');
          return {
            success: true,
            status: 'needs_input',
            field: 'description',
            reply: isEnTurn ? 'Task description is required and cannot be skipped. Please provide a description:' : 'Task ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
            speech: isEnTurn ? 'Task description is required and cannot be skipped. Please provide a description.' : 'टास्क का डिस्क्रिप्शन जरूरी है, इसको स्किप नहीं कर सकते। कृपया डिस्क्रिप्शन बताएं।',
            speakText: isEnTurn ? 'Task description is required, please provide a description.' : 'Task ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
            speakTextHi: isEnTurn ? null : 'टास्क का Description जरूरी है, इसको skip नहीं कर सकते। कृपया Description बताएं:',
            draft: currentDraft,
            missing: ['description'],
            chips: [],
            candidates: [],
            notices,
            canAssignOthers,
            progress: { done: 1, total: 10 },
            payload: null,
            preview: null,
            intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
            meta: { model: modelName },
          };
        }

        if (!actionHandled && lastAskedField === 'description' && (!currentDraft.description) && trimmedMessage.length <= 300 && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.description = trimmedMessage;
          currentDraft.description = trimmedMessage;
          if (!currentDraft.asked.includes('description')) currentDraft.asked.push('description');
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'description');
          actionHandled = true;
        }

        if (!actionHandled && lastAskedField === 'title' && (!currentDraft.title) && trimmedMessage.length <= 100 && !isFillerPhrase(trimmedMessage) && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.title = trimmedMessage;
          currentDraft.title = trimmedMessage;
          if (!currentDraft.asked.includes('title')) currentDraft.asked.push('title');
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'title');
          actionHandled = true;
        }

        if (!actionHandled && (lastAskedField === 'dueDateTime' || lastAskedField === 'dueDate') && detSlots.dueDateTime) {
          currentDraft.dueDateTime = detSlots.dueDateTime;
          if (!currentDraft.asked.includes('dueDateTime')) currentDraft.asked.push('dueDateTime');
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'dueDateTime');
          actionHandled = true;
        }

        if (!actionHandled && lastAskedField === 'priorityDays' && detSlots.priorityDays) {
          currentDraft.priorityDays = detSlots.priorityDays;
          if (!currentDraft.asked.includes('priorityDays')) currentDraft.asked.push('priorityDays');
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'priorityDays');
          actionHandled = true;
        }

        if (!actionHandled && lastAskedField === 'repeatPattern' && detSlots.repeatPattern) {
          currentDraft.repeatPattern = detSlots.repeatPattern;
          if (!currentDraft.asked.includes('repeatPattern')) currentDraft.asked.push('repeatPattern');
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'repeatPattern');
          actionHandled = true;
        }

        if (lastAskedField === 'assignee' && (!currentDraft.assigneeId) && (!currentDraft.assigneeName) && (!detSlots.assigneeName) && trimmedMessage.length <= 50 && !isSkip(trimmedMessage)) {
          detSlots.assigneeName = trimmedMessage;
        }

        if (lastAskedField === 'checkpoints' && !actionHandled) {
          detSlots.assigneeName = null;
          detSlots.pendingAssigneeNames = [];
          if (currentDraft.intent === 'self_task') {
            currentDraft.assigneeName = null;
            currentDraft.assigneeId = null;
            currentDraft.assignees = [];
            currentDraft.assignedUsers = [];
            currentDraft.pendingAssigneeNames = [];
          }
          if (isSkip(trimmedMessage) || isSkipAll(trimmedMessage)) {
            currentDraft.checkpoints = [];
            if (!currentDraft.skipped.includes('checkpoints')) currentDraft.skipped.push('checkpoints');
            if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
            actionHandled = true;
          } else {
            const parsedCps = parseCheckpointItems(trimmedMessage);
            if (parsedCps.length > 0) {
              const isAppending = /(?:add|aur|ek\s+aur)\s+checkpoint/i.test(trimmedMessage);
              const existing = Array.isArray(currentDraft.checkpoints) ? currentDraft.checkpoints : [];
              currentDraft.checkpoints = (isAppending && existing.length > 0) ? [...existing, ...parsedCps] : parsedCps;
              detSlots.checkpoints = currentDraft.checkpoints;
              currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'checkpoints');
              if (!currentDraft.asked.includes('checkpoints')) currentDraft.asked.push('checkpoints');
              actionHandled = true;
            }
          }
        }

        const { redactPIIForLLM } = require('./clientSlotFiller');
        const { redactedText: sanitizedForLlm, piiMap } = redactPIIForLLM(trimmedMessage);
        if (piiMap.email && !currentDraft.email) currentDraft.email = piiMap.email;
        if (piiMap.phone && !currentDraft.phone) currentDraft.phone = piiMap.phone;
        if (piiMap.gst && !currentDraft.gst) currentDraft.gst = piiMap.gst;
        if (piiMap.pan && !currentDraft.pan) currentDraft.pan = piiMap.pan;
        if (piiMap.pincode && !currentDraft.pincode) currentDraft.pincode = piiMap.pincode;

        // Invoke LLM extractor only if not action/pure-skip/handled
        let extracted = {};
        const shouldCallLlm = !actionHandled && !isPureIntent && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage);
        if (shouldCallLlm) {
          try {
            extracted = (await extractFn({
              message: sanitizedForLlm,
              now,
              previousDraft: currentDraft,
              req,
              intent: currentDraft.intent,
              canAssignOthers,
            })) || {};
          } catch (llmErr) {
            const errCode = llmErr?.code || llmErr?.cause?.code || 'LLM_ERROR';
            const safeMsg = String(llmErr?.message || '').replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]').slice(0, 150);
            console.error(`[ai] llm extraction failed code=${errCode} msg=${safeMsg}`);
            extracted = {};
          }
        }

        // Merge extracted slots into draft
        const merged = mergeDraft(currentDraft, extracted, detSlots, trimmedMessage);
        Object.assign(currentDraft, merged);
        if (currentDraft.intent === 'create_project') {
          currentDraft.title = null;
          currentDraft.assigneeName = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
          if (currentDraft.priority) currentDraft.priority = formatProjectPriority(currentDraft.priority);
        } else if (currentDraft.intent === 'create_client') {
          currentDraft.title = null;
          currentDraft.assigneeName = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
        } else if (currentDraft.intent === 'task_project') {
          if (currentDraft.priority) currentDraft.priority = formatProjectPriority(currentDraft.priority);
        }

        // Intent promotion: if assigneeName is extracted and user can assign others, ensure intent is task_assigned_user
        if (currentDraft.assigneeName && canAssignOthers && currentDraft.intent === 'self_task') {
          currentDraft.intent = 'task_assigned_user';
          currentDraft.taskFor = 'others';
          currentDraft.wantsOthers = true;
        } else if (!canAssignOthers && currentDraft.intent !== 'task_project' && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan') {
          currentDraft.intent = 'self_task';
          currentDraft.taskFor = 'self';
          currentDraft.wantsOthers = false;
          currentDraft.assigneeName = null;
          currentDraft.assigneeId = null;
          currentDraft.assigneeLabel = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
          currentDraft.pendingAssigneeNames = [];
        }

        // If a previously skipped field was explicitly updated in this turn, remove it from skipped
        if (detSlots.priority || extracted.priority) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priority');
        if (detSlots.status || extracted.status) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'status');
        if (detSlots.title || extracted.title) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'title');
        if (detSlots.description || extracted.description) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'description');
        if (detSlots.dueDateTime || extracted.dueDateTime) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'dueDateTime');
        if (detSlots.reminder !== undefined || extracted.reminder !== undefined) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
          if (currentDraft.reminder) {
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          }
        }
        if (detSlots.reminderOption || extracted.reminderOption) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
        }
        if ((Array.isArray(detSlots.checkpoints) && detSlots.checkpoints.length > 0) || (Array.isArray(extracted.checkpoints) && extracted.checkpoints.length > 0)) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'checkpoints');
        }
        if (detSlots.priorityDays || extracted.priorityDays) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priorityDays');

        // Apply intent AFTER extraction (when message contains both extraction AND intent)
        if (detectedIntent?.type === 'skip_all' || isSkipAll(trimmedMessage)) {
          const allOptional = (currentDraft.intent === 'self_task' && (!currentDraft.description || !String(currentDraft.description).trim()))
            ? ['priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile']
            : ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'];
          allOptional.forEach((fieldKey) => {
            if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
            if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
              if (fieldKey === 'description') currentDraft.description = '';
              if (fieldKey === 'priority') currentDraft.priority = 'medium';
              if (fieldKey === 'status') currentDraft.status = 'pending';
              if (fieldKey === 'reminder') currentDraft.reminder = false;
              if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
              if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
              if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
              if (fieldKey === 'attachments') currentDraft.attachmentsCount = 0;
              if (fieldKey === 'file') currentDraft.file = null;
              if (fieldKey === 'pdfFile') currentDraft.pdfFile = null;
            }
          });
        } else if (detectedIntent?.type === 'skip_field') {
          const target = detectedIntent.field || lastAskedField;
          if (target === 'description' && currentDraft.intent === 'self_task') {
            // Description is required for self_task - cannot skip
          } else if (target && !currentDraft.skipped.includes(target)) {
            currentDraft.skipped.push(target);
            if (target === 'description') currentDraft.description = '';
            if (target === 'priority') currentDraft.priority = 'medium';
            if (target === 'status') currentDraft.status = 'pending';
            if (target === 'reminder') currentDraft.reminder = false;
            if (target === 'priorityDays') currentDraft.priorityDays = '1';
            if (target === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (target === 'checkpoints') currentDraft.checkpoints = [];
            if (target === 'attachments') currentDraft.attachmentsCount = 0;
            if (target === 'file') currentDraft.file = null;
            if (target === 'pdfFile') currentDraft.pdfFile = null;
          }
        } else if (isSkip(trimmedMessage)) {
          const target = lastAskedField || 'description';
          if (target === 'description' && currentDraft.intent === 'self_task') {
            // Description is required for self_task - cannot skip
          } else {
            if (!currentDraft.skipped.includes(target)) currentDraft.skipped.push(target);
            if (target === 'description') currentDraft.description = '';
            if (target === 'priority') currentDraft.priority = 'medium';
            if (target === 'status') currentDraft.status = 'pending';
            if (target === 'reminder') currentDraft.reminder = false;
            if (target === 'priorityDays') currentDraft.priorityDays = '1';
            if (target === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (target === 'checkpoints') currentDraft.checkpoints = [];
            if (target === 'attachments') currentDraft.attachmentsCount = 0;
            if (target === 'file') currentDraft.file = null;
            if (target === 'pdfFile') currentDraft.pdfFile = null;
          }
        }
      }
    }
  }

  // Title sanity guard: reject command sentences/assignee echoes as task titles
  if (currentDraft.title && isInvalidOrCommandTitle(currentDraft.title, rawMessage, currentDraft.assigneeName)) {
    currentDraft.title = null;
  }

  // -------------------------------------------------------------
  // STEP 2g: Track newly extracted fields this turn for multi-field acknowledgement
  // -------------------------------------------------------------
  let newlyExtracted = [];
  if (currentDraft.intent === 'create_client') {
    if (!initialFilled.client && currentDraft.client && String(currentDraft.client).trim()) {
      newlyExtracted.push({ key: 'client', label: 'client', display: `"${currentDraft.client}"` });
    }
    if (!initialFilled.company && currentDraft.company && String(currentDraft.company).trim()) {
      newlyExtracted.push({ key: 'company', label: 'company', display: `"${currentDraft.company}"` });
    }
    if (!initialFilled.city && currentDraft.city && String(currentDraft.city).trim()) {
      newlyExtracted.push({ key: 'city', label: 'city', display: `"${currentDraft.city}"` });
    }
  } else if (currentDraft.intent === 'create_project') {
    if (!initialFilled.name && currentDraft.name && String(currentDraft.name).trim()) {
      newlyExtracted.push({ key: 'name', label: 'project name', display: `"${currentDraft.name}"` });
    }
    if (!initialFilled.startDate && currentDraft.startDate) {
      newlyExtracted.push({ key: 'startDate', label: 'start date', display: formatHumanIstDate(currentDraft.startDate) });
    }
    if (!initialFilled.endDate && currentDraft.endDate) {
      newlyExtracted.push({ key: 'endDate', label: 'end date', display: formatHumanIstDate(currentDraft.endDate) });
    }
    if (!initialFilled.members && Array.isArray(currentDraft.members) && currentDraft.members.length > 0) {
      const mNames = currentDraft.members.map(m => m.name || m.label || 'Member').join(', ');
      newlyExtracted.push({ key: 'members', label: 'members', display: mNames });
    }
  } else {
    if (!initialFilled.project && (currentDraft.projectId || currentDraft.projectName)) {
      newlyExtracted.push({ key: 'project', label: 'project', display: `"${currentDraft.projectName || currentDraft.project}"` });
    }
    if (!initialFilled.title && currentDraft.title && String(currentDraft.title).trim()) {
      newlyExtracted.push({ key: 'title', label: 'naam', display: `"${currentDraft.title}"` });
    }
    if (!initialFilled.assignee && (currentDraft.assigneeId || (currentDraft.taskFor === 'others' && currentDraft.assigneeName))) {
      newlyExtracted.push({ key: 'assignee', label: 'assignee', display: currentDraft.assigneeLabel || currentDraft.assigneeName });
    }
  }
  if (!initialFilled.description && currentDraft.description !== null && currentDraft.description !== undefined && String(currentDraft.description).trim()) {
    newlyExtracted.push({ key: 'description', label: 'description', display: `"${currentDraft.description}"` });
  }
  if (!initialFilled.priority && currentDraft.priority) {
    newlyExtracted.push({ key: 'priority', label: 'priority', display: currentDraft.priority });
  }
  if (!initialFilled.status && currentDraft.status) {
    newlyExtracted.push({ key: 'status', label: 'status', display: currentDraft.status });
  }
  if (!initialFilled.dueDateTime && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) {
    newlyExtracted.push({ key: 'dueDateTime', label: 'due date', display: formatHumanIstDate(currentDraft.dueDateTime) });
  }
  if (!initialFilled.dueDate && currentDraft.dueDate && currentDraft.intent === 'task_project' && !newlyExtracted.some(x => x.label === 'due date')) {
    newlyExtracted.push({ key: 'dueDate', label: 'due date', display: formatHumanIstDate(currentDraft.dueDate) });
  }
  if (!initialFilled.reminder && currentDraft.reminder !== null && currentDraft.reminder !== undefined) {
    let reminderDisplay = userLang === 'en' ? 'Yes' : 'Haan';
    if (!currentDraft.reminder) {
      reminderDisplay = userLang === 'en' ? 'No' : 'Nahi';
    } else if (currentDraft.repeatIntervalMinutes) {
      reminderDisplay = userLang === 'en' ? `Every ${currentDraft.repeatIntervalMinutes} min` : `Har ${currentDraft.repeatIntervalMinutes} min`;
    } else if (currentDraft.minutesBeforeDue) {
      reminderDisplay = userLang === 'en' ? `${currentDraft.minutesBeforeDue} min before` : `${currentDraft.minutesBeforeDue} min pehle`;
    } else if (currentDraft.customTime) {
      reminderDisplay = formatHumanIstDate(currentDraft.customTime);
    } else if (currentDraft.reminderOption === 'halfHourly') {
      reminderDisplay = 'Every 30 min';
    } else if (currentDraft.reminderOption === 'hourly') {
      reminderDisplay = 'Every 1 hour';
    } else if (currentDraft.reminderOption === 'oneHourBefore') {
      reminderDisplay = '1 hour before';
    }
    newlyExtracted.push({ key: 'reminder', label: 'reminder', display: reminderDisplay });
  }
  if (!initialFilled.checkpoints && Array.isArray(currentDraft.checkpoints) && currentDraft.checkpoints.length > 0) {
    newlyExtracted.push({ key: 'checkpoints', label: 'checkpoints', display: `${currentDraft.checkpoints.length} checkpoints` });
  }

  // Deduplicate newlyExtracted by label
  const seenExtractedLabels = new Set();
  newlyExtracted = newlyExtracted.filter(item => {
    if (seenExtractedLabels.has(item.label)) return false;
    seenExtractedLabels.add(item.label);
    return true;
  });

  if (!ackPrefix && currentDraft.lastTaskNotice) {
    ackPrefix = currentDraft.lastTaskNotice;
    currentDraft.lastTaskNotice = null;
  }
  const isEnUser = userLang === 'en';
  if (newlyExtracted.length >= 2) {
    const labelOrder = ['project', 'naam', 'description', 'priority', 'status', 'due date', 'assignee', 'reminder', 'checkpoints'];
    newlyExtracted.sort((a, b) => labelOrder.indexOf(a.label) - labelOrder.indexOf(b.label));

    const labels = newlyExtracted.map((item) => item.label);
    const joinedLabels = isEnUser
      ? (labels.length === 2 ? `${labels[0]} and ${labels[1]}` : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`)
      : (labels.length === 2 ? `${labels[0]} aur ${labels[1]}` : `${labels.slice(0, -1).join(', ')} aur ${labels[labels.length - 1]}`);

    const hindiLabelMap = {
      project: 'प्रोजेक्ट',
      naam: 'नाम',
      description: 'डिस्क्रिप्शन',
      priority: 'प्रायोरिटी',
      status: 'स्टेटस',
      'due date': 'ड्यू डेट',
      assignee: 'कर्मचारी',
      reminder: 'रिमाइंडर',
      checkpoints: 'चेकपॉइंट्स',
    };

    if (isEnUser) {
      const summaryLines = newlyExtracted.map((item) => {
        const lbl = item.label === 'naam' ? 'Title' : (item.label.charAt(0).toUpperCase() + item.label.slice(1));
        return `• **${lbl}**: ${item.display}`;
      }).join('\n');
      ackPrefix = `Got it! I have noted the details:\n${summaryLines}\n\n`;
      speechPrefix = `Got it! Noted ${joinedLabels}. `;
    } else {
      const summaryLines = newlyExtracted.map((item) => {
        const lbl = hindiLabelMap[item.label] || item.label;
        return `• **${lbl}**: ${item.display}`;
      }).join('\n');
      ackPrefix = `Samajh gaya! Maine ye details note kar li hain:\n${summaryLines}\n\n`;
      const speechLabels = newlyExtracted.map((item) => hindiLabelMap[item.label] || item.label);
      const joinedSpeechLabels = speechLabels.length === 2
        ? `${speechLabels[0]} और ${speechLabels[1]}`
        : `${speechLabels.slice(0, -1).join(', ')} और ${speechLabels[speechLabels.length - 1]}`;
      speechPrefix = `समझ गया: ${joinedSpeechLabels} मिल गए। `;
    }
  } else if (newlyExtracted.length === 1 && newlyExtracted[0].key === 'project') {
    ackPrefix = isEnUser
      ? `Project "${currentDraft.projectName || currentDraft.project}" selected.\n\n`
      : `Project "${currentDraft.projectName || currentDraft.project}" select ho gaya hai.\n\n`;
    speechPrefix = isEnUser
      ? `Project "${currentDraft.projectName || currentDraft.project}" selected. `
      : `प्रोजेक्ट "${currentDraft.projectName || currentDraft.project}" चुन लिया गया है। `;
  } else if (newlyExtracted.length === 1 && newlyExtracted[0].key === 'name' && currentDraft.intent === 'create_project') {
    ackPrefix = isEnUser
      ? `Creating project "${currentDraft.name}".\n\n`
      : `Project "${currentDraft.name}" create kar rahe hain.\n\n`;
    speechPrefix = isEnUser
      ? `Creating project "${currentDraft.name}". `
      : `प्रोजेक्ट "${currentDraft.name}" बना रहे हैं। `;
  }

  // -------------------------------------------------------------
  // STEP 3: Assignee disambiguation & scope validation
  // -------------------------------------------------------------
  let currentProject = null;

  if (currentDraft.intent === 'task_project') {
    // 3a. Resolve Project
    if (!currentDraft.projectId) {
      const projRes = await resolveProject({
        req,
        message: trimmedMessage,
        projectNameText: currentDraft.projectName,
        accessibleProjects,
      }, deps);

      if (projRes.status === 'single') {
        currentProject = projRes.project;
        currentDraft.projectId = String(currentProject._id);
        currentDraft.projectName = currentProject.projectName;
        currentDraft.project = currentProject.projectName;
        currentDraft.projectStartDate = currentProject.startDate;
        currentDraft.projectIdSuffix = String(currentProject._id).slice(-6);
        currentDraft.showDistinguishing = Boolean(
          currentDraft.showDistinguishing || requiresProjectDistinguishing(currentProject, accessibleProjects)
        );
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
      } else if (projRes.status === 'multiple') {
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        let rep = projRes.reply;
        const chipsKey = (projRes.chips || []).map((c) => c.label).sort().join('|');
        if (
          currentDraft._lastReply === rep &&
          currentDraft._lastChipsKey === chipsKey &&
          rawMessage &&
          currentDraft._lastUserMsg &&
          rawMessage.trim().toLowerCase() !== currentDraft._lastUserMsg.trim().toLowerCase()
        ) {
          rep = `Mujhe samajh nahi aaya. ${rep}`;
        }
        currentDraft._lastReply = rep;
        currentDraft._lastChipsKey = chipsKey;
        currentDraft._lastUserMsg = rawMessage ? rawMessage.trim() : '';

        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'project',
          reply: rep,
          speech: projRes.speech,
          speakText: projRes.speech || rep,
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: projRes.projects || [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      } else {
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        let rep = projRes.reply;
        const chipsKey = (projRes.chips || []).map((c) => c.label).sort().join('|');
        if (
          currentDraft._lastReply === rep &&
          currentDraft._lastChipsKey === chipsKey &&
          rawMessage &&
          currentDraft._lastUserMsg &&
          rawMessage.trim().toLowerCase() !== currentDraft._lastUserMsg.trim().toLowerCase()
        ) {
          rep = `Mujhe samajh nahi aaya. ${rep}`;
        }
        currentDraft._lastReply = rep;
        currentDraft._lastChipsKey = chipsKey;
        currentDraft._lastUserMsg = rawMessage ? rawMessage.trim() : '';

        return {
          success: true,
          status: 'needs_input',
          field: 'project',
          reply: rep,
          speech: projRes.speech,
          speakText: projRes.speech || rep,
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      }
    } else {
      currentProject = accessibleProjects.find((p) => idsEqual(p._id, currentDraft.projectId));
      if (!currentProject) {
        currentDraft.projectId = null;
        currentDraft.projectName = null;
        currentDraft.project = null;
        currentDraft.projectStartDate = null;
        currentDraft.projectIdSuffix = null;
        currentDraft.showDistinguishing = false;
        const projRes = await resolveProject({
          req,
          message: trimmedMessage,
          projectNameText: null,
          accessibleProjects,
        }, deps);
        return {
          success: true,
          status: 'needs_input',
          field: 'project',
          reply: 'Chuna gaya project nahi mila ya aapke paas access nahi hai. Niche se chun lein:',
          speech: 'चुना गया प्रोजेक्ट नहीं मिला। नीचे से चुन लें।',
          speakText: 'Chuna gaya project nahi mila. Niche se chun lein.',
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      }
      currentDraft.projectName = currentProject.projectName;
      currentDraft.project = currentProject.projectName;
      currentDraft.projectStartDate = currentProject.startDate;
      currentDraft.projectIdSuffix = String(currentProject._id).slice(-6);
      currentDraft.showDistinguishing = Boolean(
        currentDraft.showDistinguishing || requiresProjectDistinguishing(currentProject, accessibleProjects)
      );
    }

    // 3b. Resolve Project Assignee against project members via Name Ledger
    const wantsProjectAssignee = Boolean(
      (currentDraft.pendingAssigneeNames && currentDraft.pendingAssigneeNames.length > 0) ||
      currentDraft.assigneeName ||
      pick?.assigneeId ||
      action?.assigneeId ||
      currentDraft.assigneeId ||
      (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) ||
      (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)
    );

    if (wantsProjectAssignee && currentProject) {
      if (!Array.isArray(currentDraft.assigneeLedger) || currentDraft.assigneeLedger.length === 0) {
        const rawName = currentDraft.assigneeName || currentDraft.assigneeLabel;
        if (rawName) {
          const multi = extractMultipleAssignees(rawName);
          const names = multi.names && multi.names.length > 0 ? multi.names : [rawName];
          currentDraft.assigneeLedger = createLedger(names);
          if (currentDraft.assigneeId) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: currentDraft.assigneeId,
              name: rawName,
              pool: currentProject.users || [],
            });
          }
        } else if (currentDraft.assigneeId) {
          const member = (currentProject.users || []).find((u) => idsEqual(u._id || u, currentDraft.assigneeId));
          const mName = member?.name || 'Member';
          currentDraft.assigneeLedger = createLedger([mName]);
          updateLedgerWithPick(currentDraft, {
            assigneeId: currentDraft.assigneeId,
            name: mName,
            pool: currentProject.users || [],
          });
        }
      }

      // Handle direct chip pick
      const pickedId = pick?.assigneeId || (action?.field === 'assignee' && action.assigneeId ? action.assigneeId : null);
      if (pickedId) {
        const member = (currentProject.users || []).find((u) => idsEqual(u._id || u, pickedId));
        if (member) {
          updateLedgerWithPick(currentDraft, {
            assigneeId: String(member._id || member),
            name: member.name,
            pool: currentProject.users || [],
          });
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        } else {
          notices.push('Selected user is project ke member nahi hain.');
        }
      }

      // If user typed/spoke answering an assignee prompt
      if (trimmedMessage && !pickedId && !action?.assigneeId) {
        const isAffirmativeInput = /^(?:haan|ha|han|yes|yep|yeah|sahi|theek|thik|ji|ok|okay)\b/i.test(trimmedMessage) || detectedIntent?.type === 'confirm_yes';
        const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
        if (isAffirmativeInput && currentDraft.suggestedAssignee && unresolved) {
          updateLedgerWithPick(currentDraft, {
            assigneeId: String(currentDraft.suggestedAssignee.id || currentDraft.suggestedAssignee._id),
            name: currentDraft.suggestedAssignee.name,
            targetName: unresolved.rawName,
            pool: currentProject.users || [],
          });
          currentDraft.suggestedAssignee = null;
        } else if (unresolved && !hasExplicitFieldEditIntent(trimmedMessage) && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage)) {
          const directMatch = (currentProject.users || []).find(u => {
            const uName = String(u.name || '').toLowerCase();
            return uName.includes(trimmedMessage.toLowerCase()) || trimmedMessage.toLowerCase().includes(uName);
          });
          if (directMatch) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: String(directMatch._id || directMatch),
              name: directMatch.name,
              targetName: unresolved.rawName,
              pool: currentProject.users || [],
            });
          }
        }
      }

      // Fetch company users for not_member differentiation
      let companyUsers = [];
      if (Array.isArray(deps.companyUsers)) {
        companyUsers = deps.companyUsers;
      } else if (isDbReady && UserModel && typeof UserModel.find === 'function' && companyId) {
        try {
          companyUsers = await UserModel.find({ company: companyId, isActive: true })
            .select('_id name email employeeId jobRole department')
            .lean();
        } catch {
          companyUsers = [];
        }
      }

      // Evaluate unresolved ledger entries
      const rawPool = currentProject.users || [];
      const userMap = new Map();
      (companyUsers || []).forEach(u => {
        userMap.set(String(u._id || u.id), u);
      });
      const pool = rawPool.map(u => {
        if (typeof u === 'string') return userMap.get(String(u)) || { _id: u, name: u };
        if (u && typeof u === 'object') {
          if (!u.name && (u._id || u.id)) return userMap.get(String(u._id || u.id)) || u;
          return u;
        }
        return u;
      });
      const resolvedNotices = [];
      for (const entry of currentDraft.assigneeLedger) {
        if (entry.status === 'resolved') {
          const isMember = pool.some(u => idsEqual(u._id || u, entry.userId));
          const inScope = isMember || (await isAssigneeInScopeFn(req, scope, entry.userId, deps));
          if (!inScope) {
            entry.status = 'open';
            entry.userId = null;
            entry.resolvedUser = null;
          } else {
            continue;
          }
        }
        if (entry.status === 'removed_by_user') continue;
        evaluateLedgerEntry(entry, pool, companyUsers, { isProject: true });
        if (entry.status === 'resolved') {
          resolvedNotices.push(`${entry.user.name} add ho gaye`);
        }
      }
      syncAssigneeLedgerDerivedFields(currentDraft);

      const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
      if (unresolved) {
        if (unresolved.status === 'fuzzy_suggestions' && unresolved.suggestedUser) {
          currentDraft.suggestedAssignee = unresolved.suggestedUser;
        }
        const prefixH = resolvedNotices.length > 0 ? `${resolvedNotices.join('. ')}. ` : '';
        const prefixHi = resolvedNotices.length > 0 ? `${resolvedNotices.join('. ')}। ` : '';
        const promptObj = buildUnresolvedEntryPrompt(unresolved, prefixH, prefixHi);
        return {
          success: true,
          status: promptObj.status,
          field: 'assignee',
          reply: promptObj.reply,
          speech: promptObj.speech,
          speakText: promptObj.speech || promptObj.reply,
          draft: currentDraft,
          missing: ['assigneeId'],
          chips: promptObj.chips,
          candidates: unresolved.candidates || [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          payload: null,
          preview: null,
          intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
          meta: { model: modelName },
        };
      } else if (resolvedNotices.length > 0) {
        notices.push(...resolvedNotices);
      }
    }
  } else if ((currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan') || ((currentDraft.intent === 'create_project' || currentDraft.intent === 'create_client') && (currentDraft.asked.includes('members') || currentDraft.asked.includes('projectManager') || lastAskedField === 'members' || lastAskedField === 'projectManager' || (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)))) {
    // 3c. Regular Assignee disambiguation & scope validation (self_task & task_assigned_user, or create_project members / create_client team)
    const wantsAssignee = Boolean(
      (currentDraft.pendingAssigneeNames && currentDraft.pendingAssigneeNames.length > 0) ||
      currentDraft.assigneeName ||
      pick?.assigneeId ||
      action?.assigneeId ||
      currentDraft.assigneeId ||
      (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) ||
      (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)
    );

    if (wantsAssignee) {
      if (!canAssignOthers && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client' && currentDraft.intent !== 'create_client_plan' && currentDraft.intent !== 'create_client') {
        currentDraft.taskFor = 'self';
        currentDraft.wantsOthers = false;
        currentDraft.intent = 'self_task';
        currentDraft.assigneeName = null;
        currentDraft.assigneeId = null;
        currentDraft.assigneeLabel = null;
        currentDraft.assignees = [];
        currentDraft.assignedUsers = [];
        currentDraft.pendingAssigneeNames = [];
        currentDraft.assigneeLedger = [];
        notices.push('Aapko dusron ko task assign karne ki permission nahi hai, isliye ye aapke liye banaunga.');
      } else {
        if (!Array.isArray(currentDraft.assigneeLedger) || currentDraft.assigneeLedger.length === 0) {
          const rawName = currentDraft.assigneeName || currentDraft.assigneeLabel;
          if (rawName) {
            const multi = extractMultipleAssignees(rawName);
            const names = multi.names && multi.names.length > 0 ? multi.names : [rawName];
            currentDraft.assigneeLedger = createLedger(names);
            if (currentDraft.assigneeId) {
              updateLedgerWithPick(currentDraft, {
                assigneeId: currentDraft.assigneeId,
                name: rawName,
                pool: [],
              });
            }
          } else if (currentDraft.assigneeId) {
            currentDraft.assigneeLedger = createLedger(['User']);
            updateLedgerWithPick(currentDraft, {
              assigneeId: currentDraft.assigneeId,
              name: 'User',
              pool: [],
            });
          }
        }

        // Direct chip pick
        const pickedId = pick?.assigneeId || (action?.field === 'assignee' && action.assigneeId ? action.assigneeId : null);
        if (pickedId) {
          let foundUser = null;
          if (isDbReady && mongoose.Types.ObjectId.isValid(pickedId) && companyId) {
            try {
              foundUser = await UserModel.findOne({
                _id: pickedId,
                company: companyId,
                isActive: true,
                ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
              }).select('_id name employeeId jobRole department branch').lean();
            } catch {
              foundUser = null;
            }
          }
          if (!foundUser) {
            foundUser = {
              _id: pickedId,
              id: pickedId,
              name: action?.value || pick?.name || pick?.value || 'User',
              department: action?.department || 'General',
            };
          }

          const inScope = await isAssigneeInScopeFn(req, scope, foundUser._id || foundUser.id, deps);
          if (!inScope) {
            notices.push('Selected user aapke branch ya department scope se bahar hain. Kripya kisi aur ko chunein.');
          } else {
            let deptDisplay = String(foundUser.department || '').trim();
            if (isDbReady && mongoose.Types.ObjectId.isValid(deptDisplay) && DeptModel) {
              try {
                const dDoc = await DeptModel.findOne({ _id: deptDisplay, company: companyId })
                  .select('name departmentName')
                  .lean();
                if (dDoc) deptDisplay = dDoc.name || dDoc.departmentName || deptDisplay;
              } catch {}
            }
            foundUser.department = deptDisplay || 'General';
            foundUser.label = formatAssigneeLabel(foundUser, deptDisplay);

            updateLedgerWithPick(currentDraft, {
              assigneeId: String(foundUser._id || foundUser.id),
              name: foundUser.name,
              targetName: action?.targetName || action?.assigneeTargetName,
              pool: [foundUser],
            });
            if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
          }
        }

        // If user typed/spoke answering an assignee prompt
        if (trimmedMessage && !pickedId && !action?.assigneeId) {
          const isAffirmativeInput = /^(?:haan|ha|han|yes|yep|yeah|sahi|theek|thik|ji|ok|okay)\b/i.test(trimmedMessage) || detectedIntent?.type === 'confirm_yes';
          const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
          if (isAffirmativeInput && currentDraft.suggestedAssignee && unresolved) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: String(currentDraft.suggestedAssignee.id || currentDraft.suggestedAssignee._id),
              name: currentDraft.suggestedAssignee.name,
              targetName: unresolved.rawName,
              pool: [currentDraft.suggestedAssignee],
            });
            currentDraft.suggestedAssignee = null;
          }
        }

        // Evaluate unresolved ledger entries
        const resolvedNotices = [];
        for (const entry of (currentDraft.assigneeLedger || [])) {
          if (entry.status === 'resolved') {
            // Re-verify that entry.userId actually belongs to the authenticated user's company
            // Never trust client-supplied userId or status: 'resolved'
            const inScope = await isAssigneeInScopeFn(req, scope, entry.userId, { ...deps, companyUsers });
            if (!inScope) {
              entry.status = 'open';
              entry.userId = null;
              entry.resolvedUser = null;
            } else {
              continue;
            }
          }
          if (entry.status === 'removed_by_user') continue;
          if (entry.status === 'not_found') continue;

          const resolution = await resolveAssigneeFn({
            name: entry.rawName,
            requester: req.user,
          }, deps);

          if (resolution.status === 'fuzzy') {
            entry.status = 'ambiguous';
            entry.isFuzzy = true;
            entry.suggestedName = resolution.suggestedName || resolution.user?.name;
            const candUser = resolution.user;
            const id = String(candUser.id || candUser._id);
            entry.candidates = [{
              id,
              _id: id,
              name: candUser.name,
              employeeId: candUser.employeeId || '',
              jobRole: candUser.jobRole && candUser.jobRole !== 'user' ? candUser.jobRole : '',
              department: candUser.department || 'General',
              label: `Did you mean ${candUser.name}?`,
            }];
            continue;
          } else if (resolution.status === 'multiple') {
            entry.status = 'ambiguous';
            const rawCandidates = resolution.candidates || [];
            let deptMap = new Map();
            if (isDbReady && companyId) {
              const deptIdsToLookup = rawCandidates
                .map((c) => String(c.department || ''))
                .filter((d) => mongoose.Types.ObjectId.isValid(d));
              if (deptIdsToLookup.length > 0 && DeptModel) {
                try {
                  const deptDocs = await DeptModel.find({
                    _id: { $in: deptIdsToLookup },
                    company: companyId,
                  }).select('_id name departmentName').lean();
                  (deptDocs || []).forEach((d) => {
                    deptMap.set(String(d._id), d.name || d.departmentName || '');
                  });
                } catch {}
              }
            }

            entry.candidates = rawCandidates.map((c) => {
              const id = String(c.id || c._id);
              let dept = String(c.department || '').trim();
              if (mongoose.Types.ObjectId.isValid(dept) && deptMap.has(dept)) {
                dept = deptMap.get(dept);
              }
              const candObj = {
                id,
                _id: id,
                name: c.name,
                employeeId: c.employeeId || '',
                jobRole: c.jobRole && c.jobRole !== 'user' ? c.jobRole : '',
                department: dept || 'General',
              };
              candObj.label = c.label || formatAssigneeLabel(candObj, candObj.department);
              return candObj;
            });
            continue; // Record ambiguous and continue resolving other entries
          } else if (resolution.status === 'single' || resolution.status === 'resolved') {
            const candidateUser = resolution.user || (Array.isArray(resolution.matches) ? resolution.matches[0] : null);
            const inScope = await isAssigneeInScopeFn(req, scope, candidateUser._id || candidateUser.id, deps);
            if (inScope) {
              const idStr = String(candidateUser._id || candidateUser.id);
              entry.status = 'resolved';
              entry.userId = idStr;
              entry.user = {
                id: idStr,
                _id: idStr,
                name: candidateUser.name,
                label: candidateUser.label || formatAssigneeLabel(candidateUser, candidateUser.department),
                department: candidateUser.department || 'General',
              };
              entry.candidates = [];
              resolvedNotices.push(`${candidateUser.name} add ho gaye`);
            } else {
              notices.push(`${candidateUser.name} aapke branch ya department scope se bahar hain.`);
              entry.status = 'not_member';
            }
          } else if (resolution.status === 'none') {
            notices.push(`"${entry.displayName || entry.rawName}" naam ka koi employee nahi mila. Kripya sahi naam batayein.`);
            entry.status = 'not_found';
          }
        }

        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.user?.name || e.displayName || e.rawName,
              label: e.user?.label || e.displayName || e.rawName,
              department: e.user?.department || 'General',
            }));
          }
        }

        if (currentDraft.intent === 'create_client' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.projectManager = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.user?.name || e.displayName || e.rawName,
              label: e.user?.label || e.displayName || e.rawName,
            }));
            currentDraft.team = currentDraft.projectManager;
            currentDraft.members = currentDraft.projectManager;
          }
        }

        const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
        if (unresolved) {
          if (unresolved.status === 'ambiguous') {
            candidates = unresolved.candidates || [];
            const isFuzzy = Boolean(unresolved.isFuzzy);
            const isClientFlow = currentDraft.intent === 'create_client';
            const isProjectFlow = currentDraft.intent === 'create_project';
            const actionType = isClientFlow ? 'set_team_member' : (isProjectFlow ? 'set_project_member' : 'set');
            const targetField = isClientFlow ? 'team' : (isProjectFlow ? 'members' : 'assignee');
            const disambigNoticePrefix = notices.length > 0 ? notices.join(' ') + '\n\n' : '';
            return {
              success: true,
              status: 'needs_disambiguation',
              field: targetField,
              reply: disambigNoticePrefix + (isFuzzy
                ? `Kya aapka matlab "${unresolved.suggestedName}" hai?`
                : `"${unresolved.displayName || unresolved.rawName}" naam ke multiple users mile hain. Kripya list me se sahi user chunein.`),
              speech: isFuzzy
                ? `क्या आपका मतलब "${unresolved.suggestedName}" है?`
                : `"${unresolved.displayName || unresolved.rawName}" नाम के कई कर्मचारी मिले हैं। कृपया सही कर्मचारी चुनें।`,
              speakText: isFuzzy
                ? `Kya aapka matlab ${unresolved.suggestedName} hai?`
                : `"${unresolved.displayName || unresolved.rawName}" naam ke multiple users mile hain. Sahi user chunein.`,
              draft: currentDraft,
              missing: [targetField === 'members' ? 'members' : (targetField === 'team' ? 'projectManager' : 'assigneeId')],
              chips: candidates.map((c) => ({
                label: isFuzzy ? `Did you mean ${c.name}?` : (c.label || c.name),
                action: {
                  type: actionType,
                  field: targetField,
                  value: c.name,
                  assigneeId: String(c.id || c._id),
                  department: c.department,
                },
              })),
              candidates,
              notices,
              canAssignOthers,
              progress: { done: 4, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
        } else if (resolvedNotices.length > 0) {
          notices.push(...resolvedNotices);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Guided Slot-Filling Sequence (Exactly one next question)
  // -------------------------------------------------------------
  // 3c. Disambiguate person in action title (e.g. "Call Priya about invoice kal 5 baje")
  if (canAssignOthers && currentDraft.taskFor !== 'others' && currentDraft.intent !== 'task_project' && !currentDraft.titlePersonHandled) {
    const personInTitle = currentDraft.titlePersonCandidate || detectPersonInActionTitle(currentDraft.title || rawMessage);
    if (personInTitle) {
      currentDraft.titlePersonCandidate = personInTitle;
      if (!currentDraft.asked.includes('assigneeConfirmation')) currentDraft.asked.push('assigneeConfirmation');
      return {
        success: true,
        status: 'needs_input',
        field: 'assigneeConfirmation',
        reply: `${ackPrefix}${personInTitle} ko assign karna hai?`,
        speech: `${speechPrefix}${personInTitle} को असाइन करना है?`,
        speakText: `${personInTitle} ko assign karna hai?`,
        draft: currentDraft,
        missing: ['assigneeConfirmation'],
        chips: [
          { label: 'Haan, assign karo', action: { type: 'set', field: 'assignee', value: personInTitle } },
          { label: 'Nahi, title mein hi hai', action: { type: 'keep_title_person', name: personInTitle } },
        ],
        candidates: [],
        notices,
        canAssignOthers,
        progress: { done: 1, total: 8 },
        meta: { model: modelName },
      };
    }
  }

  let activeIntent = currentDraft.intent;
  if (activeIntent !== 'task_project' && activeIntent !== 'create_project' && activeIntent !== 'create_client' && activeIntent !== 'create_client_task' && activeIntent !== 'create_client_plan') {
    const isOthersTask = Boolean(
      canAssignOthers &&
      (currentDraft.taskFor === 'others' || currentDraft.intent === 'task_assigned_user' || currentDraft.wantsOthers) &&
      !currentDraft.skipped.includes('assignee')
    );
    activeIntent = isOthersTask ? 'task_assigned_user' : 'self_task';
    currentDraft.intent = activeIntent;
    if (isOthersTask) {
      currentDraft.taskFor = 'others';
      currentDraft.wantsOthers = true;
    }
  }

  // Duplicate project name check:
  if (activeIntent === 'create_project' && currentDraft.name && !currentDraft.duplicateHandled) {
    const dup = findDuplicateProject(currentDraft.name, accessibleProjects);
    if (dup) {
      if (!currentDraft.asked.includes('name')) currentDraft.asked.push('name');
      const dupStatus = dup.status ? (dup.status.charAt(0).toUpperCase() + dup.status.slice(1)) : 'Active';
      const dupDate = dup.startDate ? formatHumanIstDate(dup.startDate) : 'No date';
      const dupMembersCount = Array.isArray(dup.users) ? dup.users.length : 0;
      const dupSummary = `Status: ${dupStatus}, Start: ${dupDate}, ${dupMembersCount} members`;

      return {
        success: true,
        status: 'needs_disambiguation',
        field: 'name',
        reply: `Is naam ka project pehle se maujood hai: "${dup.projectName}" (${dupSummary}). Kya aap yahi naam rakhna chahte hain ya doosra naam chunna chahte hain?`,
        speech: `इस नाम का प्रोजेक्ट पहले से मौजूद है। क्या आप यही नाम रखना चाहते हैं या दूसरा नाम चुनना चाहते हैं?`,
        speakText: `Is naam ka project pehle se maujood hai: "${dup.projectName}". Kya aap yahi naam rakhna chahte hain?`,
        draft: currentDraft,
        missing: ['name'],
        chips: [
          { label: `Haan, yahi naam rakhein (${dupStatus})`, action: { type: 'confirm_duplicate_project_name' } },
          { label: 'Doosra naam batayein', action: { type: 'change_project_name' } },
        ],
        candidates: [dup],
        notices,
        canAssignOthers,
      };
    }
  }

  // Duplicate client name check (Item 5):
  if (activeIntent === 'create_client' && currentDraft.client && !currentDraft.duplicateHandled) {
    const { findDuplicateClient } = require('./clientSlotFiller');
    const accessibleClients = scope.accessibleClients || [];
    const dupResult = findDuplicateClient(currentDraft.client, currentDraft.company, accessibleClients);
    if (dupResult) {
      if (!currentDraft.asked.includes('client')) currentDraft.asked.push('client');
      if (dupResult.type === 'both') {
        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'client',
          reply: `Client "${currentDraft.client}" aur company "${currentDraft.company}" pehle se maujood hai.`,
          speech: 'क्लाइंट और कंपनी पहले से मौजूद है।',
          speakText: `Client "${currentDraft.client}" aur company "${currentDraft.company}" pehle se maujood hai.`,
          draft: currentDraft,
          missing: ['client'],
          chips: [
            { label: 'Doosra naam batayein', action: { type: 'change_client_name' } },
            { label: 'Cancel', action: { type: 'cancel' } },
          ],
          candidates: [dupResult.client],
          notices,
          canAssignOthers,
        };
      } else {
        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'client',
          reply: `Client "${currentDraft.client}" pehle se maujood hai. Existing client mein nayi company add karna abhi support nahi hai.`,
          speech: 'क्लाइंट पहले से मौजूद है।',
          speakText: `Client "${currentDraft.client}" pehle se maujood hai.`,
          draft: currentDraft,
          missing: ['client'],
          chips: [
            { label: 'Doosra naam batayein', action: { type: 'change_client_name' } },
            { label: 'Cancel', action: { type: 'cancel' } },
          ],
          candidates: [dupResult.client],
          notices,
          canAssignOthers,
        };
      }
    }
  }
  const activeFields = getIntentSlots(activeIntent, currentDraft);

  // In project task: if status is 'in progress' and no assignee, unskip assignee
  if (activeIntent === 'task_project' && formatProjectStatus(currentDraft.status) === 'in progress' && !currentDraft.assigneeId) {
    currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
  }

  // Check which field is missing next
  let nextFieldKey = null;

  for (const fieldKey of activeFields) {
    if (currentDraft.skipped.includes(fieldKey)) {
      if (currentDraft.intent === 'self_task' && fieldKey === 'description' && (!currentDraft.description || !String(currentDraft.description).trim())) {
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'description');
      } else {
        continue;
      }
    }

    if (fieldKey === 'client') {
      if (!currentDraft.client || !String(currentDraft.client).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'company') {
      if (!currentDraft.company || !String(currentDraft.company).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'city') {
      if (!currentDraft.city || !String(currentDraft.city).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'email') {
      if (!currentDraft.email || !String(currentDraft.email).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'projectManager') {
      const hasPm = ((Array.isArray(currentDraft.projectManager) && currentDraft.projectManager.length > 0) ||
                    (Array.isArray(currentDraft.team) && currentDraft.team.length > 0) ||
                    (Array.isArray(currentDraft.members) && currentDraft.members.length > 0)) && Boolean(currentDraft.teamDone);
      if (!hasPm) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'services') {
      if (currentDraft.activeDetailsGroup) continue;
      if (currentDraft.intent === 'create_client' && currentDraft.clientPlanId) continue;
      const isServicesDone = Boolean(currentDraft.servicesDone || currentDraft.servicesSkipped);
      if (!isServicesDone) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'serviceTasks') {
      if (currentDraft.activeDetailsGroup) continue;
      if (currentDraft.intent === 'create_client') continue;
      const isServiceTasksDone = Boolean(currentDraft.serviceTasksDone || currentDraft.serviceTasksSkipped);
      if (!isServiceTasksDone) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'clientPlan') {
      if (currentDraft.activeDetailsGroup) continue;
      const isPlanDone = currentDraft.clientPlanDone || currentDraft.clientPlanSkipped || currentDraft.clientPlanId || currentDraft.asked.includes('clientPlan');
      if (!isPlanDone) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'subscriptionStartDate') {
      if (currentDraft.activeDetailsGroup) continue;
      if (currentDraft.clientPlanId && !currentDraft.subscriptionStartDate) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'more_details') {
      if (!currentDraft.moreDetailsDone) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'name') {
      if (!currentDraft.name || !String(currentDraft.name).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'price') {
      if (currentDraft.price === null || currentDraft.price === undefined) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'months') {
      if (!currentDraft.months) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'startDate') {
      if (!currentDraft.startDate) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'endDate') {
      if (!currentDraft.endDate) {
        nextFieldKey = fieldKey;
        break;
      }
      if (currentDraft.startDate && currentDraft.endDate) {
        const s = new Date(currentDraft.startDate).getTime();
        const e = new Date(currentDraft.endDate).getTime();
        if (!isNaN(s) && !isNaN(e) && e < s) {
          notices.push('End date start date se pehle nahi ho sakti. Kripya naya end date batayein.');
          currentDraft.endDate = null;
          nextFieldKey = fieldKey;
          break;
        }
      }
    } else if (fieldKey === 'members') {
      const hasMembers = (Array.isArray(currentDraft.members) && currentDraft.members.length > 0) ||
        (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0);
      if (!hasMembers) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'project') {
      if (!currentDraft.projectId) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'assignee') {
      if (activeIntent === 'task_project') {
        if (formatProjectStatus(currentDraft.status) === 'in progress' && !currentDraft.assigneeId) {
          nextFieldKey = fieldKey;
          break;
        }
        if (!currentDraft.assigneeId && !currentDraft.skipped.includes('assignee') && (currentDraft.asked.includes('assignee') || currentDraft.wantsOthers || currentDraft.assigneeName)) {
          nextFieldKey = fieldKey;
          break;
        }
      } else if (activeIntent === 'task_assigned_user') {
        const hasAssignee = Boolean(currentDraft.assigneeId || (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) || (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0));
        if (!hasAssignee) {
          nextFieldKey = fieldKey;
          break;
        }
      } else {
        if (!currentDraft.assigneeId) {
          nextFieldKey = fieldKey;
          break;
        }
      }
    } else if (fieldKey === 'title') {
      if (!currentDraft.title || !String(currentDraft.title).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'dueDateTime') {
      if (!currentDraft.dueDateTime) {
        nextFieldKey = fieldKey;
        break;
      }
      const dueMs = new Date(currentDraft.dueDateTime).getTime();
      if (isNaN(dueMs) || dueMs <= now.getTime()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'dueDate') {
      const rawDue = currentDraft.dueDate || currentDraft.dueDateTime;
      if (!rawDue) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'description') {
      if (currentDraft.description === null || currentDraft.description === undefined) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'priority') {
      if (!currentDraft.priority) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'status') {
      if (!currentDraft.status) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'reminder') {
      if (currentDraft.reminder === null || currentDraft.reminder === undefined) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'reminderOption') {
      if (!currentDraft.reminderOption) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'priorityDays') {
      if (!currentDraft.priorityDays) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'repeatPattern') {
      if (!currentDraft.repeatPattern) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'checkpoints') {
      if (!currentDraft.asked.includes('checkpoints') && (!currentDraft.checkpoints || currentDraft.checkpoints.length === 0)) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'attachments' || fieldKey === 'file') {
      if (!currentDraft.asked.includes(fieldKey) && currentDraft.attachmentsCount === 0 && !currentDraft.file && !currentDraft.pdfFile) {
        nextFieldKey = fieldKey;
        break;
      }
    }
  }

  // Calculate progress
  const total = activeFields.length;
  let done = 0;
  for (const f of activeFields) {
    if (currentDraft.skipped.includes(f)) {
      done += 1;
    } else if (f === 'name' && (currentDraft.name || currentDraft.projectName)) {
      done += 1;
    } else if (f === 'startDate' && currentDraft.startDate) {
      done += 1;
    } else if (f === 'endDate' && currentDraft.endDate) {
      done += 1;
    } else if (f === 'members' && ((Array.isArray(currentDraft.members) && currentDraft.members.length > 0) || (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0))) {
      done += 1;
    } else if (f === 'pdfFile' && (currentDraft.asked.includes(f) || currentDraft.pdfFile || currentDraft.documentPdf)) {
      done += 1;
    } else if (f === 'project' && currentDraft.projectId) {
      done += 1;
    } else if (f === 'assignee' && currentDraft.assigneeId) {
      done += 1;
    } else if (f === 'title' && currentDraft.title) {
      done += 1;
    } else if (f === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) {
      done += 1;
    } else if (f === 'dueDate' && (currentDraft.dueDate || currentDraft.dueDateTime)) {
      done += 1;
    } else if (f === 'description' && currentDraft.description !== null) {
      done += 1;
    } else if (f === 'priority' && currentDraft.priority) {
      done += 1;
    } else if (f === 'status' && currentDraft.status) {
      done += 1;
    } else if (f === 'reminder' && currentDraft.reminder !== null) {
      done += 1;
    } else if (f === 'reminderOption' && currentDraft.reminderOption) {
      done += 1;
    } else if (f === 'priorityDays' && currentDraft.priorityDays) {
      done += 1;
    } else if (f === 'serviceTasks' && (currentDraft.serviceTasksDone || currentDraft.serviceTasksSkipped)) {
      done += 1;
    } else if (f === 'repeatPattern' && currentDraft.repeatPattern) {
      done += 1;
    } else if (f === 'checkpoints' && (currentDraft.asked.includes('checkpoints') || (currentDraft.checkpoints && currentDraft.checkpoints.length > 0))) {
      done += 1;
    } else if ((f === 'attachments' || f === 'file') && (currentDraft.asked.includes(f) || currentDraft.attachmentsCount > 0 || currentDraft.file || currentDraft.pdfFile)) {
      done += 1;
    }
  }

    // -------------------------------------------------------------
  // STEP 5: Return Question OR Ready status
  // -------------------------------------------------------------
  if (nextFieldKey) {
    currentDraft.asked = currentDraft.asked.filter((f) => f !== nextFieldKey);
    currentDraft.asked.push(nextFieldKey);

    // Anti-looping counter & question selection
    const priorAskCount = currentDraft.askCounts[nextFieldKey] || 0;
    currentDraft.askCounts[nextFieldKey] = priorAskCount + 1;
    const isReAsk = priorAskCount >= 1; // Already asked at least once before

    const fieldConfig = TASK_FIELDS[nextFieldKey] || {};
    const isPastDueTime = nextFieldKey === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() <= now.getTime();

    const isEnTurn = userLang === 'en';
    const hasCommandInMsg = /\b(?:task|assign|banao|bana\s*do|create|kar\s*do|kardo|karo)\b/i.test(rawMessage);
    const askTitleQuestion = (nextFieldKey === 'title' && !isReAsk && hasCommandInMsg)
      ? (isEnTurn ? 'What should be the task title?' : 'Task ka naam kya hoga?')
      : null;
    const askTitleSpeech = (nextFieldKey === 'title' && !isReAsk && hasCommandInMsg)
      ? (isEnTurn ? 'What should be the task title?' : 'टास्क का नाम क्या होगा?')
      : null;

    let defaultEnReply = 'Please provide the next detail:';
    let defaultEnSpeech = 'Please provide the next detail.';
    if (nextFieldKey === 'title') {
      defaultEnReply = 'What should be the task title?';
      defaultEnSpeech = 'What should be the task title?';
    } else if (nextFieldKey === 'priority') {
      defaultEnReply = 'What priority should we set? Low, Medium, or High?';
      defaultEnSpeech = 'What priority should we set? Low, Medium, or High?';
    } else if (nextFieldKey === 'status') {
      defaultEnReply = 'What should be the task status? Pending, In Progress, On Hold, or Completed?';
      defaultEnSpeech = 'What should be the task status? Pending, In Progress, On Hold, or Completed?';
    } else if (nextFieldKey === 'dueDateTime' || nextFieldKey === 'dueDate') {
      defaultEnReply = 'When should this task be completed? Please specify the date and time.';
      defaultEnSpeech = 'When should this task be completed? Please specify the date and time.';
    } else if (nextFieldKey === 'description') {
      if (currentDraft.intent === 'self_task') {
        defaultEnReply = 'What should be the task description? (Required):';
        defaultEnSpeech = 'Please provide the task description.';
      } else {
        defaultEnReply = 'What description would you like to add?';
        defaultEnSpeech = 'What description would you like to add?';
      }
    } else if (nextFieldKey === 'assignee') {
      defaultEnReply = 'Who is this task for? Please provide the employee name:';
      defaultEnSpeech = 'Who is this task for? Please provide the employee name.';
    } else if (nextFieldKey === 'project') {
      defaultEnReply = 'Which project should this task be added to? Please provide the project name:';
      defaultEnSpeech = 'Which project should this task be added to? Please provide the project name.';
    } else if (nextFieldKey === 'reminder') {
      defaultEnReply = 'Would you like to set a reminder? (Yes or No)';
      defaultEnSpeech = 'Would you like to set a reminder?';
    } else if (nextFieldKey === 'checkpoints') {
      defaultEnReply = 'Would you like to add checkpoints? You can list them separated by commas (e.g. "test 1, checking crm, testing") or tap Skip:';
      defaultEnSpeech = 'Would you like to add checkpoints? You can list them separated by commas or tap Skip.';
    }

    let replyText = isPastDueTime
      ? (isEnTurn ? 'This time has already passed. Please specify a new time or pick tomorrow.' : 'Yeh samay beet chuka hai. Kripya naya time batayein ya kal ka samay chunein.')
      : (askTitleQuestion || ((isReAsk && fieldConfig.reAskQuestion?.reply)
        ? (isEnTurn ? (fieldConfig.reAskQuestion?.replyEn || defaultEnReply) : fieldConfig.reAskQuestion.reply)
        : (isEnTurn ? (fieldConfig.question?.replyEn || defaultEnReply) : (fieldConfig.question?.reply || 'Agli detail batayein:'))));

    let speechText = isPastDueTime
      ? (isEnTurn ? 'This time has already passed. Please specify a new time.' : 'यह समय बीत चुका है। कृपया नया समय बताएं या कल का समय चुनें।')
      : (askTitleSpeech || ((isReAsk && fieldConfig.reAskQuestion?.speech)
        ? (isEnTurn ? (fieldConfig.reAskQuestion?.speechEn || defaultEnSpeech) : fieldConfig.reAskQuestion.speech)
        : (isEnTurn ? (fieldConfig.question?.speechEn || defaultEnSpeech) : (fieldConfig.question?.speech || 'अगली डिटेल बताएं:'))));

    let speakTextHi = null;
    let chipsList = [];
    if (activeIntent === 'task_assigned_user' && nextFieldKey === 'assignee') {
      const assigneesList = Array.isArray(currentDraft.assignees) ? currentDraft.assignees : [];
      if (assigneesList.length > 0) {
        const names = assigneesList.map(a => a.name || a.label).join(', ');
        replyText = ackPrefix + (isEnTurn
          ? `Selected members: ${names}.\n\nWould you like to assign anyone else or click [Done]?`
          : `Selected members: ${names}.\n\nAur kisi ko assign karna hai ya [Done] dabayein?`);
        speechText = isEnTurn
          ? 'Would you like to assign anyone else or click Done?'
          : 'Aur kisi ko assign karna hai ya Done dabayein?';
        speakTextHi = isEnTurn ? null : 'और किसी को assign करना है या [Done] दबाएं?';
      } else {
        replyText = ackPrefix + (isEnTurn
          ? 'Who should this task be assigned to? Select a team member or type their name:'
          : 'Task kisse assign karna hai? Team member chunein ya naam batayein:');
        speechText = isEnTurn
          ? 'Who should this task be assigned to? Select a team member or type their name.'
          : 'टास्क किसे असाइन करना है? टीम मेंबर चुनें या नाम बताएं:';
        speakTextHi = isEnTurn ? null : 'Task किसे assign करना है? Team member चुनें या नाम बताएं:';
      }
      chipsList = buildChips('task_assigned_user', 'assignee', {
        ...deps,
        companyUsers: deps.companyUsers,
        draft: currentDraft,
        memberPage: currentDraft.memberPage || 0,
      });
    } else if (activeIntent === 'task_project' && nextFieldKey === 'assignee' && currentProject) {
      chipsList = (currentProject.users || []).slice(0, 8).map((m) => ({
        label: m.name,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id || m) },
      }));
      if (formatProjectStatus(currentDraft.status) !== 'in progress') {
        chipsList.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
      }
      chipsList.push({ label: 'Cancel', action: { type: 'cancel' } });
    } else if (activeIntent === 'create_client') {
      if (currentDraft.creatingManualPlan && currentDraft.manualPlan) {
        const mPlan = currentDraft.manualPlan;
        if (mPlan.step === 'name') {
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_name',
            reply: ackPrefix + 'Naye Client Plan ka naam batayein (zaroori hai):',
            speech: 'Naye Client Plan ka naam batayein.',
            speakText: 'Naye Client Plan ka naam batayein (zaroori hai):',
            speakTextHi: 'नए Client Plan का नाम बताएं:',
            draft: currentDraft,
            missing: ['manual_plan_name'],
            chips: [{ label: 'Cancel', action: { type: 'cancel_manual_plan' } }],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'price') {
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_price',
            reply: ackPrefix + 'Plan "' + mPlan.name + '" ka price (₹) kitna hoga?',
            speech: 'Plan ka price kitna hoga?',
            speakText: 'Plan "' + mPlan.name + '" ka price (₹) kitna hoga?',
            speakTextHi: 'Plan का price कितना होगा?',
            draft: currentDraft,
            missing: ['manual_plan_price'],
            chips: [
              { label: 'Free / ₹0', action: { type: 'set_manual_plan_field', field: 'price', value: 0 } },
              { label: '₹1,000', action: { type: 'set_manual_plan_field', field: 'price', value: 1000 } },
              { label: '₹5,000', action: { type: 'set_manual_plan_field', field: 'price', value: 5000 } },
              { label: '₹10,000', action: { type: 'set_manual_plan_field', field: 'price', value: 10000 } },
              { label: '₹25,000', action: { type: 'set_manual_plan_field', field: 'price', value: 25000 } },
              { label: 'Cancel', action: { type: 'cancel_manual_plan' } }
            ],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'months') {
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_months',
            reply: ackPrefix + 'Plan duration kitne months ki hogi? (jaise 1, 3, 6, 12):',
            speech: 'Plan duration kitne months ki hogi?',
            speakText: 'Plan duration kitne months ki hogi? (jaise 1, 3, 6, 12):',
            speakTextHi: 'Plan duration कितने months की होगी?',
            draft: currentDraft,
            missing: ['manual_plan_months'],
            chips: [
              { label: '1 Month', action: { type: 'set_manual_plan_field', field: 'months', value: 1 } },
              { label: '3 Months', action: { type: 'set_manual_plan_field', field: 'months', value: 3 } },
              { label: '6 Months', action: { type: 'set_manual_plan_field', field: 'months', value: 6 } },
              { label: '12 Months', action: { type: 'set_manual_plan_field', field: 'months', value: 12 } },
              { label: 'Cancel', action: { type: 'cancel_manual_plan' } }
            ],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'status') {
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_status',
            reply: ackPrefix + 'Plan status kya rakhna hai? (Active ya Inactive):',
            speech: 'Plan status kya rakhna hai?',
            speakText: 'Plan status kya rakhna hai? (Active ya Inactive):',
            speakTextHi: 'Plan status क्या रखना है?',
            draft: currentDraft,
            missing: ['manual_plan_status'],
            chips: [
              { label: 'Active', action: { type: 'set_manual_plan_field', field: 'status', value: 'Active' } },
              { label: 'Inactive', action: { type: 'set_manual_plan_field', field: 'status', value: 'Inactive' } },
              { label: 'Cancel', action: { type: 'cancel_manual_plan' } }
            ],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'description') {
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_description',
            reply: ackPrefix + 'Plan ka description batayein (optional, ya \'Skip\' bole):',
            speech: 'Plan ka description batayein ya Skip bole.',
            speakText: 'Plan ka description batayein (optional, ya \'Skip\' bole):',
            speakTextHi: 'Plan का description बताएं:',
            draft: currentDraft,
            missing: ['manual_plan_description'],
            chips: [
              { label: 'Skip', action: { type: 'set_manual_plan_field', field: 'description', value: '' } },
              { label: 'Cancel', action: { type: 'cancel_manual_plan' } }
            ],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'services') {
          let compServices = Array.isArray(deps.services) ? deps.services : [];
          if (compServices.length === 0) {
            compServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'];
          }
          const selected = Array.isArray(mPlan.services) ? mPlan.services : [];
          const chips = [];
          chips.push({ label: 'Done', action: { type: 'finish_manual_plan_services' } });
          compServices.forEach(s => {
            const sName = typeof s === 'string' ? s : (s.servicename || s.name);
            const isSel = selected.includes(sName);
            chips.push({
              label: isSel ? ('✓ ' + sName) : sName,
              action: isSel ? { type: 'remove_manual_plan_service', service: sName } : { type: 'add_manual_plan_service', service: sName }
            });
          });
          chips.push({ label: 'Cancel', action: { type: 'cancel_manual_plan' } });
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_services',
            reply: ackPrefix + (selected.length > 0 ? ('Selected services: ' + selected.join(', ') + '.\n\nAur services add karein ya [Done] dabayein:') : 'Is plan mein kaun kaun si services include karni hain? Services chunein:'),
            speech: 'Is plan mein kaun kaun si services include karni hain?',
            speakText: 'Is plan mein kaun kaun si services include karni hain? Services chunein:',
            speakTextHi: 'इस Plan में कौन कौन सी services include करनी हैं?',
            draft: currentDraft,
            missing: ['manual_plan_services'],
            chips,
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
        if (mPlan.step === 'ready') {
          const previewText = ackPrefix + '📋 **Create / Edit Client Plan Preview**\n\n• **Plan Name:** ' + mPlan.name + '\n• **Price:** ₹' + Number(mPlan.price || 0).toLocaleString('en-IN') + '\n• **Plan Duration:** ' + (mPlan.months || 1) + ' Month(s)\n• **Status:** ' + (mPlan.status || 'Active') + '\n• **Description:** ' + (mPlan.description || '—') + '\n• **Services:** ' + ((mPlan.services || []).join(', ') || 'None') + '\n\nKya is plan ko save karke use karein?';
          return {
            success: true,
            status: 'needs_input',
            field: 'manual_plan_ready',
            reply: previewText,
            speech: 'Plan draft taiyar hai. Kya is plan ko save karke use karein?',
            speakText: previewText,
            speakTextHi: 'Plan draft तैयार है। क्या इस plan को save करके use करें?',
            draft: currentDraft,
            missing: ['manual_plan_ready'],
            chips: [
              { label: 'Save and use plan', action: { type: 'save_and_use_plan' } },
              { label: 'Edit', action: { type: 'edit_manual_plan', field: 'name' } },
              { label: 'Cancel', action: { type: 'cancel_manual_plan' } }
            ],
            candidates: [],
            notices,
            canAssignOthers,
          };
        }
      }
      if (nextFieldKey === 'client') {
        replyText = ackPrefix + (isEnTurn ? 'Please provide the client name (required):' : 'Client ka naam batayein (zaroori hai):');
        speechText = isEnTurn ? 'Please provide the client name (required).' : 'क्लाइंट का नाम बताएं (ज़रूरी है):';
        speakTextHi = isEnTurn ? null : 'क्लाइंट का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'company') {
        replyText = ackPrefix + (isEnTurn ? 'Please provide the company name (required):' : 'Company ka naam batayein (zaroori hai):');
        speechText = isEnTurn ? 'Please provide the company name (required).' : 'कंपनी का नाम बताएं (ज़रूरी है):';
        speakTextHi = isEnTurn ? null : 'कंपनी का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'city') {
        replyText = ackPrefix + (isEnTurn ? 'Please provide the city name (required):' : 'City ka naam batayein (zaroori hai):');
        speechText = isEnTurn ? 'Please provide the city name (required).' : 'सिटी का नाम बताएं (ज़रूरी है):';
        speakTextHi = isEnTurn ? null : 'सिटी का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'email') {
        replyText = ackPrefix + (isEnTurn ? 'Please provide the client email address (required):' : 'Client ka email address batayein (zaroori hai):');
        speechText = isEnTurn ? 'Please provide the client email address (required).' : 'क्लाइंट का ईमेल एड्रेस बताएं (ज़रूरी है):';
        speakTextHi = isEnTurn ? null : 'Client का email address बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'status') {
        replyText = ackPrefix + (isEnTurn ? 'What should be the client status? (Active, On Hold, or Inactive):' : 'Client ka status kya rakhna hai? (Active, On Hold, ya Inactive):');
        speechText = isEnTurn ? 'What should be the client status? Active, On Hold, or Inactive?' : 'Client ka status kya rakhna hai? Active, On Hold, ya Inactive?';
        speakTextHi = isEnTurn ? null : 'Client का Status क्या रखना है? Active, On Hold, या Inactive?';
        chipsList = [
          { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
          { label: 'On Hold', action: { type: 'set', field: 'status', value: 'On Hold' } },
          { label: 'Inactive', action: { type: 'set', field: 'status', value: 'Inactive' } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'projectManager') {
        const pmList = Array.isArray(currentDraft.projectManager) ? currentDraft.projectManager : [];
        if (pmList.length > 0) {
          const names = pmList.map(m => m.name || m).join(', ');
          replyText = ackPrefix + (isEnTurn ? `Selected team members: ${names}.\n\nWould you like to add any other member or click [Done]?` : `Selected team members: ${names}.\n\nAur kisi member ko add karna hai ya [Done] dabayein?`);
          speechText = isEnTurn ? 'Would you like to add any other member or click Done?' : 'Aur kisi member ko add karna hai ya Done dabayein?';
          speakTextHi = isEnTurn ? null : 'और किसी member को add करना है या [Done] दबाएं?';
        } else {
          replyText = ackPrefix + (isEnTurn ? 'Please specify the team member who will manage this client (at least one is required):' : 'Team member ka naam batayein jo is client ko manage karenge (kam se kam ek member zaroori hai):');
          speechText = isEnTurn ? 'Please specify the team member who will manage this client.' : 'टीम मेंबर का नाम बताएं जो इस क्लाइंट को मैनेज करेंगे:';
          speakTextHi = isEnTurn ? null : 'टीम मेंबर का नाम बताएं जो इस क्लाइंट को मैनेज करेंगे:';
        }
        chipsList = buildChips('create_client', 'projectManager', {
          ...deps,
          companyUsers: deps.companyUsers,
          draft: currentDraft,
          memberPage: currentDraft.memberPage || 0,
        });
      }
      else if (nextFieldKey === 'services') {
        let companyServices = [];
        if (currentDraft.allowedPlanServices && Array.isArray(currentDraft.allowedPlanServices) && currentDraft.allowedPlanServices.length > 0) {
          companyServices = currentDraft.allowedPlanServices;
        } else if (currentDraft.clientPlanId) {
          const plans = Array.isArray(deps.clientPlans) ? deps.clientPlans : (Array.isArray(scope?.clientPlans) ? scope.clientPlans : []);
          const selP = plans.find(p => String(p._id || p.id) === String(currentDraft.clientPlanId) || p.name === currentDraft.clientPlanName);
          if (selP && Array.isArray(selP.services) && selP.services.length > 0) {
            companyServices = selP.services.map(s => typeof s === 'string' ? s : (s.service || s.name || s.servicename)).filter(Boolean);
            currentDraft.allowedPlanServices = companyServices;
          }
        }
        if (companyServices.length === 0) {
          if (scope.services && Array.isArray(scope.services)) {
            companyServices = scope.services;
          } else if (deps.Service || mongoose.models.Service) {
            const ServiceModel = deps.Service || mongoose.models.Service;
            try {
              const docs = await ServiceModel.find({
                ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {})
              }).select('servicename').lean();
              companyServices = docs.map(d => d.servicename).filter(Boolean);
            } catch {
              companyServices = [];
            }
          }
        }
        if (companyServices.length === 0) {
          companyServices = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design'];
        }
        const selected = Array.isArray(currentDraft.services) ? currentDraft.services : [];

        if (selected.length > 0) {
          const justAdded = (action?.type === 'add_client_service' && action?.service) ? action.service : null;
          const justRemoved = (action?.type === 'remove_client_service' && action?.service) ? action.service : null;

          if (justAdded) {
            replyText = ackPrefix + (isEnTurn
              ? `"${justAdded}" service added.\nSelected services: ${selected.join(', ')}.\n\nWould you like to add any other service or click [Done]?`
              : `"${justAdded}" service add ho gayi.\nSelected services: ${selected.join(', ')}.\n\nAur koi service add karni hai ya [Done] dabayein?`);
            speechText = isEnTurn
              ? `"${justAdded}" service added. Would you like to add any other service or click Done?`
              : `"${justAdded}" service add ho gayi. Aur koi service deni hai ya Done dabayein?`;
            speakTextHi = isEnTurn ? null : `"${justAdded}" Service add हो गई। और कोई Service देनी है या [Done] दबाएं?`;
          } else if (justRemoved) {
            replyText = ackPrefix + (isEnTurn
              ? `"${justRemoved}" service removed.\nSelected services: ${selected.length > 0 ? selected.join(', ') : 'None'}.\n\nWould you like to add any other service or click [Done]?`
              : `"${justRemoved}" service remove kar di.\nSelected services: ${selected.length > 0 ? selected.join(', ') : 'Koi nahi'}.\n\nAur koi service add karni hai ya [Done] dabayein?`);
            speechText = isEnTurn
              ? `"${justRemoved}" service removed. Would you like to add any other service or click Done?`
              : `"${justRemoved}" service remove kar di. Aur service deni hai ya Done dabayein?`;
            speakTextHi = isEnTurn ? null : `"${justRemoved}" Service हटा दी। और Service देनी है या [Done] दबाएं?`;
          } else {
            replyText = ackPrefix + (isEnTurn
              ? `Selected services: ${selected.join(', ')}.\n\nWould you like to add any other service or click [Done]?`
              : `Selected services: ${selected.join(', ')}.\n\nAur koi service add karni hai ya [Done] dabayein?`);
            speechText = isEnTurn
              ? 'Would you like to add any other service or click Done?'
              : 'Aur koi service deni hai ya Done dabayein?';
            speakTextHi = isEnTurn ? null : 'और कोई Service देनी है या [Done] दबाएं?';
          }

          const unselectedChips = companyServices
            .filter(s => !selected.includes(s))
            .map(s => ({ label: s, action: { type: 'add_client_service', service: s } }));
          const removeChips = selected.map(s => ({
            label: 'Remove ' + s,
            action: { type: 'remove_client_service', service: s },
          }));

          chipsList = [
            { label: 'Done', action: { type: 'finish_client_services' } },
            ...unselectedChips,
            ...removeChips,
            { label: isEnTurn ? 'Not now' : 'Abhi nahi', action: { type: 'skip_client_services' } },
          ];
        } else {
          replyText = ackPrefix + (isEnTurn ? 'Which services would you like to provide to this client?' : 'Is client ko kaun si services deni hain?');
          speechText = isEnTurn ? 'Which services would you like to provide to this client?' : 'Is client ko kaun si services deni hain?';
          speakTextHi = isEnTurn ? null : 'इस Client को कौन सी Services देनी हैं?';
          chipsList = [
            ...companyServices.map(s => ({ label: s, action: { type: 'add_client_service', service: s } })),
            { label: 'Done', action: { type: 'finish_client_services' } },
            { label: isEnTurn ? 'Not now' : 'Abhi nahi', action: { type: 'skip_client_services' } },
          ];
        }
      } else if (nextFieldKey === 'serviceTasks') {
        if (currentDraft.addingServiceTasks && currentDraft.activeTaskService) {
          const s = currentDraft.activeTaskService;
          replyText = ackPrefix + (isEnTurn ? `Please provide the task name to add in "${s}":` : `Task ka naam batao jo "${s}" mein add karna hai:`);
          speechText = isEnTurn ? `Please provide the task name to add in ${s}.` : `Task ka naam batao jo ${s} mein add karna hai`;
          speakTextHi = isEnTurn ? null : `Task ka naam batao jo ${s} mein add karna hai`;
          chipsList = buildChips('create_client', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else if (currentDraft.addingServiceTasks && currentDraft.lastAddedService) {
          const s = currentDraft.lastAddedService;
          const notice = ackPrefix || (isEnTurn ? `Task added in "${s}". ` : `"${s}" mein task add ho gaya. `);
          replyText = notice + (isEnTurn ? 'Would you like to create another task in this service or in another service?' : 'Ismein koi aur task create karna hai ya kisi aur service mein task create karna hai?');
          speechText = notice + (isEnTurn ? 'Would you like to create another task in this service or in another service?' : 'Ismein koi aur task create karna hai ya kisi aur service mein banana hai?');
          speakTextHi = isEnTurn ? null : notice + 'Ismein koi aur task create karna hai ya kisi aur service mein banana hai?';
          chipsList = buildChips('create_client', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else if (currentDraft.addingServiceTasks) {
          replyText = ackPrefix + (isEnTurn ? 'Which service would you like to add a task for? Select a service:' : 'Kaun si service ke liye task add karna hai? Service select kijiye jisme task add karna hai:');
          speechText = isEnTurn ? 'Which service would you like to add a task for? Select a service.' : 'Kaun si service ke liye task add karna hai? Service select kijiye';
          speakTextHi = isEnTurn ? null : 'Kaun si service ke liye task add karna hai? Service select kijiye';
          chipsList = buildChips('create_client', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else {
          replyText = ackPrefix + (isEnTurn ? 'Would you like to add any tasks under these services?' : 'Kya aap in services mein koi task add karna chahte hain?');
          speechText = isEnTurn ? 'Would you like to add any tasks under these services?' : 'Kya aap in services mein koi task add karna chahte hain?';
          speakTextHi = isEnTurn ? null : 'क्या आप इन सर्विसेज में कोई टास्क जोड़ना चाहते हैं?';
          chipsList = buildChips('create_client', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        }
      } else if (nextFieldKey === 'clientPlan') {
        replyText = ackPrefix + (isEnTurn ? 'Which plan would you like to assign to this client? Select a plan, or create a new plan:' : 'Client ke liye kaun sa plan lagana hai? Plan chunein, ya naya plan banayein:');
        speechText = isEnTurn ? 'Which plan would you like to assign to this client?' : 'Client ke liye kaun sa plan lagana hai?';
        speakTextHi = isEnTurn ? null : 'Client के लिए कौन सा plan लगाना है? Plan चुनें, या नया plan बनाएं:';
        let companyPlans = [];
        if (Array.isArray(deps.clientPlans) && deps.clientPlans.length > 0) {
          companyPlans = deps.clientPlans;
        } else if (scope.clientPlans && Array.isArray(scope.clientPlans) && scope.clientPlans.length > 0) {
          companyPlans = scope.clientPlans;
        } else if (deps.ClientPlan || mongoose.models.ClientPlan) {
          const PlanModel = deps.ClientPlan || mongoose.models.ClientPlan;
          try {
            companyPlans = await PlanModel.find({
              ...(cleanCompanyCode ? { companyCode: cleanCompanyCode } : {}),
              isActive: true,
            }).lean();
          } catch {
            companyPlans = [];
          }
        }
        if (companyPlans.length === 0) {
          companyPlans = [{ _id: 'plan_gold', name: 'Gold', price: 5000, months: 1 }];
        }
        chipsList = companyPlans.map(p => {
          const priceStr = p.price ? ('₹' + Number(p.price).toLocaleString('en-IN')) : 'Free';
          const monthsStr = (p.months || 1) + 'm';
          return {
            label: p.name + ' (' + priceStr + ' / ' + monthsStr + ')',
            action: {
              type: 'set_client_plan',
              planId: p._id ? p._id.toString() : p.name,
              planName: p.name,
              price: p.price,
              months: p.months || 1,
              services: p.services || []
            }
          };
        });
        chipsList.push({ label: isEnTurn ? 'Without plan (Free)' : 'Bina plan ke (Free)', action: { type: 'skip_client_plan' } });
        chipsList.push({ label: 'Cancel', action: { type: 'cancel' } });
      } else if (nextFieldKey === 'subscriptionStartDate') {
        const planName = currentDraft.clientPlanName || 'Plan';
        replyText = ackPrefix + (isEnTurn ? `Please provide the subscription start date for "${planName}":` : `Plan "${planName}" ke liye subscription start date batayein:`);
        speechText = isEnTurn ? 'Please provide the subscription start date.' : 'Subscription start date batayein.';
        speakTextHi = isEnTurn ? null : 'Subscription start date बताएं:';
        chipsList = [
          { label: isEnTurn ? 'From today' : 'Aaj se', action: { type: 'set_subscription_start_date', value: 'today' } },
          { label: isEnTurn ? 'From tomorrow' : 'Kal se', action: { type: 'set_subscription_start_date', value: 'tomorrow' } },
        ];
      } else if (nextFieldKey === 'more_details') {
        const completedGroups = Array.isArray(currentDraft.completedDetailsGroups) ? currentDraft.completedDetailsGroups : [];
        const allGroups = ['contact', 'business', 'address', 'notes', 'logo'];
        const remainingGroups = allGroups.filter((g) => !completedGroups.includes(g));

        if (currentDraft.activeDetailsGroup) {
          const group = currentDraft.activeDetailsGroup;
          const skippedFields = Array.isArray(currentDraft.skippedDetailsFields) ? currentDraft.skippedDetailsFields : [];

          if (group === 'logo') {
            if (!currentDraft.companyLogo && !currentDraft.companyLogoName && !skippedFields.includes('logo')) {
              currentDraft.activeGroupField = 'logo';
              replyText = ackPrefix + 'Kripya clip (attachment) button se company ka logo upload karein (PNG, JPG, JPEG ya WEBP, max 2 MB):';
              speechText = 'Company logo attach karein.';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'logo' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else {
              if (!completedGroups.includes('logo')) {
                completedGroups.push('logo');
                currentDraft.completedDetailsGroups = completedGroups;
              }
              currentDraft.activeDetailsGroup = null;
              currentDraft.activeGroupField = null;
            }
          } else if (group === 'contact') {
            if (!currentDraft.email && !skippedFields.includes('email')) {
              currentDraft.activeGroupField = 'email';
              replyText = ackPrefix + 'Client ka email batayein (optional):';
              speechText = 'क्लाइंट का ईमेल बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'email' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.phone && !skippedFields.includes('phone')) {
              currentDraft.activeGroupField = 'phone';
              replyText = ackPrefix + 'Client ka phone number batayein (optional):';
              speechText = 'फ़ोन नंबर बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'phone' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            }
          } else if (group === 'business') {
            if (!currentDraft.industry && !skippedFields.includes('industry')) {
              currentDraft.activeGroupField = 'industry';
              replyText = ackPrefix + 'Industry batayein (optional):';
              speechText = 'इंडस्ट्री बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'industry' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.gst && !skippedFields.includes('gst')) {
              currentDraft.activeGroupField = 'gst';
              replyText = ackPrefix + 'GST number batayein (optional):';
              speechText = 'जीएसटी नंबर बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'gst' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.pan && !skippedFields.includes('pan')) {
              currentDraft.activeGroupField = 'pan';
              replyText = ackPrefix + 'PAN number batayein (optional):';
              speechText = 'पैन नंबर बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'pan' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.website && !skippedFields.includes('website')) {
              currentDraft.activeGroupField = 'website';
              replyText = ackPrefix + 'Website batayein (optional):';
              speechText = 'वेबसाइट बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'website' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            }
          } else if (group === 'address') {
            if (!currentDraft.address && !skippedFields.includes('address')) {
              currentDraft.activeGroupField = 'address';
              replyText = ackPrefix + 'Office address batayein (optional):';
              speechText = 'ऑफिस एड्रेस बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'address' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.state && !skippedFields.includes('state')) {
              currentDraft.activeGroupField = 'state';
              replyText = ackPrefix + 'State batayein (optional):';
              speechText = 'स्टेट बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'state' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.country && !skippedFields.includes('country')) {
              currentDraft.activeGroupField = 'country';
              replyText = ackPrefix + 'Country batayein (optional):';
              speechText = 'कंट्री बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'country' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.pincode && !skippedFields.includes('pincode')) {
              currentDraft.activeGroupField = 'pincode';
              replyText = ackPrefix + 'Pincode batayein (optional):';
              speechText = 'पिनकोड बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'pincode' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            }
          } else if (group === 'notes') {
            if (!currentDraft.description && !skippedFields.includes('description')) {
              currentDraft.activeGroupField = 'description';
              replyText = ackPrefix + 'Description batayein (optional):';
              speechText = 'डिस्क्रिप्शन बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'description' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            } else if (!currentDraft.notes && !skippedFields.includes('notes')) {
              currentDraft.activeGroupField = 'notes';
              replyText = ackPrefix + 'Notes batayein (optional):';
              speechText = 'नोट्स बताएं:';
              chipsList = [
                { label: 'Skip', action: { type: 'skip_client_field', field: 'notes' } },
                { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
              ];
            }
          }
        }

        if (!currentDraft.activeGroupField || !chipsList.length) {
          const hasAnyDetails = completedGroups.length > 0 || Boolean(
            currentDraft.email || currentDraft.phone || currentDraft.industry ||
            currentDraft.gst || currentDraft.pan || currentDraft.website ||
            currentDraft.address || currentDraft.state || currentDraft.pincode ||
            currentDraft.notes || currentDraft.description
          );

          if (completedGroups.length > 0) {
            replyText = ackPrefix + 'Aur kuch dena hai?';
            speechText = 'और कुछ देना है?';
          } else {
            replyText = ackPrefix + 'Aur details dena hain?';
            speechText = 'और डिटेल्स देना हैं?';
          }

          chipsList = remainingGroups.map((g) => {
            const labelMap = { contact: 'Contact', business: 'Business', address: 'Address', notes: 'Notes' };
            return { label: labelMap[g] || g, action: { type: 'select_details_group', group: g } };
          });
          chipsList.push({ label: 'Nahi, bas', action: { type: 'finish_more_details' } });
        }
      }
    } else if (activeIntent === 'create_client_plan') {
      if (nextFieldKey === 'name') {
        replyText = ackPrefix + (isEnTurn ? 'What should be the plan name? (e.g. "Gold Plan", "Basic Plan"):' : 'Plan ka naam kya rakhna hai? (Jaise "Gold Plan", "Basic Plan"):');
        speechText = isEnTurn ? 'What should be the plan name?' : 'Plan ka naam kya rakhna hai?';
        speakTextHi = isEnTurn ? null : 'Plan का नाम क्या रखना है?';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'price') {
        replyText = ackPrefix + (isEnTurn ? 'What is the plan price (in ₹)?' : 'Plan ka price (₹ mein) kitna hoga?');
        speechText = isEnTurn ? 'What is the plan price?' : 'Plan ka price kitna hoga?';
        speakTextHi = isEnTurn ? null : 'Plan का price कितना होगा?';
        chipsList = [
          { label: 'Free (₹0)', action: { type: 'set', field: 'price', value: 0 } },
          { label: '₹1,000', action: { type: 'set', field: 'price', value: 1000 } },
          { label: '₹2,500', action: { type: 'set', field: 'price', value: 2500 } },
          { label: '₹5,000', action: { type: 'set', field: 'price', value: 5000 } },
          { label: '₹10,000', action: { type: 'set', field: 'price', value: 10000 } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'months') {
        replyText = ackPrefix + (isEnTurn ? 'What is the plan duration in months?' : 'Plan ki duration kitne mahine (months) hogi?');
        speechText = isEnTurn ? 'What is the plan duration in months?' : 'Plan ki duration kitne mahine hogi?';
        speakTextHi = isEnTurn ? null : 'Plan की duration कितने महीने होगी?';
        chipsList = [
          { label: '1 Month', action: { type: 'set', field: 'months', value: 1 } },
          { label: '3 Months', action: { type: 'set', field: 'months', value: 3 } },
          { label: '6 Months', action: { type: 'set', field: 'months', value: 6 } },
          { label: '12 Months (1 Year)', action: { type: 'set', field: 'months', value: 12 } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'status') {
        replyText = ackPrefix + (isEnTurn ? 'What should be the plan status? Active or Inactive?' : 'Plan ka status kya rakhna hai? Active ya Inactive?');
        speechText = isEnTurn ? 'What should be the plan status?' : 'Plan ka status kya rakhna hai?';
        speakTextHi = isEnTurn ? null : 'Plan का status क्या रखना है? Active या Inactive?';
        chipsList = [
          { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
          { label: 'Inactive', action: { type: 'set', field: 'status', value: 'Inactive' } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'description') {
        replyText = ackPrefix + (isEnTurn ? 'What is the plan description? (You can click "Skip" if none):' : 'Plan ka description kya likhna hai? Agar nahi likhna toh "Skip" kar sakte hain:');
        speechText = isEnTurn ? 'What is the plan description?' : 'Plan ka description kya likhna hai?';
        speakTextHi = isEnTurn ? null : 'Plan का description क्या लिखना है?';
        chipsList = [
          { label: isEnTurn ? 'None / Skip' : 'Koi nahi / Skip', action: { type: 'skip_plan_description' } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'services') {
        const compServices = Array.isArray(deps.services) ? deps.services : (scope?.services || ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development']);
        const selected = Array.isArray(currentDraft.services) ? currentDraft.services : [];
        replyText = ackPrefix + (selected.length > 0 ? (isEnTurn ? ('Selected services: ' + selected.join(', ') + '. Add more or click [Done]:') : ('Selected services: ' + selected.join(', ') + '. Aur add karein ya [Done] dabayein:')) : (isEnTurn ? 'Which services should be included in this plan? Select services and click "Done":' : 'Is plan mein kaun si services shamil karni hain? Services chunein aur "Done" dabayein:'));
        speechText = isEnTurn ? 'Select services and click Done.' : 'Services chunein aur Done dabayein.';
        speakTextHi = isEnTurn ? null : 'Services चुनें और Done दबाएं।';
        chipsList = [
          { label: 'Done', action: { type: 'finish_plan_services' } },
          ...compServices.map(s => ({
            label: selected.includes(s) ? ('✓ ' + s) : s,
            action: { type: 'toggle_plan_service', service: s },
          })),
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'serviceTasks') {
        if (currentDraft.addingServiceTasks && currentDraft.activeTaskService) {
          const s = currentDraft.activeTaskService;
          replyText = ackPrefix + (isEnTurn ? `Please provide the task name to add in "${s}":` : `Task ka naam batao jo "${s}" mein add karna hai:`);
          speechText = isEnTurn ? `Please provide the task name to add in ${s}.` : `Task ka naam batao jo ${s} mein add karna hai`;
          speakTextHi = isEnTurn ? null : `Task ka naam batao jo ${s} mein add karna hai`;
          chipsList = buildChips('create_client_plan', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else if (currentDraft.addingServiceTasks && currentDraft.lastAddedService) {
          const s = currentDraft.lastAddedService;
          const notice = ackPrefix || (isEnTurn ? `Task added in "${s}". ` : `"${s}" mein task add ho gaya. `);
          replyText = notice + (isEnTurn ? 'Would you like to create another task in this service or in another service?' : 'Ismein koi aur task create karna hai ya kisi aur service mein task create karna hai?');
          speechText = notice + (isEnTurn ? 'Would you like to create another task in this service or in another service?' : 'Ismein koi aur task create karna hai ya kisi aur service mein banana hai?');
          speakTextHi = isEnTurn ? null : notice + 'Ismein koi aur task create karna hai ya kisi aur service mein banana hai?';
          chipsList = buildChips('create_client_plan', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else if (currentDraft.addingServiceTasks) {
          replyText = ackPrefix + (isEnTurn ? 'Which service would you like to add a task for? Select a service:' : 'Kaun si service ke liye task add karna hai? Service select kijiye jisme task add karna hai:');
          speechText = isEnTurn ? 'Which service would you like to add a task for? Select a service.' : 'Kaun si service ke liye task add karna hai? Service select kijiye';
          speakTextHi = isEnTurn ? null : 'Kaun si service ke liye task add karna hai? Service select kijiye';
          chipsList = buildChips('create_client_plan', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        } else {
          replyText = ackPrefix + (isEnTurn ? 'Would you like to add any tasks under these services?' : 'Kya aap in services mein koi task add karna chahte hain?');
          speechText = isEnTurn ? 'Would you like to add any tasks under these services?' : 'Kya aap in services mein koi task add karna chahte hain?';
          speakTextHi = isEnTurn ? null : 'क्या आप इन सर्विसेज में कोई टास्क जोड़ना चाहते हैं?';
          chipsList = buildChips('create_client_plan', 'serviceTasks', { ...deps, draft: currentDraft, language: userLang });
        }
      }

    } else if (activeIntent === 'create_project') {
      if (nextFieldKey === 'name') {
        replyText = ackPrefix + (isEnTurn ? 'What is the new project name? (required):' : 'Naye project ka naam kya hoga?');
        speechText = isEnTurn ? 'What is the new project name?' : 'नए प्रोजेक्ट का नाम क्या होगा?';
        speakTextHi = isEnTurn ? null : 'नए प्रोजेक्ट का नाम क्या होगा?';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'description') {
        replyText = ackPrefix + (isEnTurn ? 'Please provide the project description (required):' : 'Project ka description batayein (zaroori hai):');
        speechText = isEnTurn ? 'Please provide the project description.' : 'प्रोजेक्ट का Description बताइए (जरूरी है)।';
        speakTextHi = isEnTurn ? null : 'प्रोजेक्ट का Description बताइए (जरूरी है)।';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'startDate') {
        const todayStr = formatIstDate(now);
        const tomorrowDate = new Date(now);
        tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
        const tomorrowStr = formatIstDate(tomorrowDate);
        replyText = ackPrefix + (isEnTurn ? 'What is the project start date?' : 'Project kis date se shuru hoga? (Start Date batayein)');
        speechText = isEnTurn ? 'What is the project start date?' : 'प्रोजेक्ट किस तारीख से शुरू होगा?';
        speakTextHi = isEnTurn ? null : 'प्रोजेक्ट किस तारीख से शुरू होगा?';
        chipsList = [
          { label: isEnTurn ? 'From today' : 'Aaj se', action: { type: 'set', field: 'startDate', value: todayStr } },
          { label: isEnTurn ? 'From tomorrow' : 'Kal se', action: { type: 'set', field: 'startDate', value: tomorrowStr } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'endDate') {
        const oneMonthDate = new Date(now);
        oneMonthDate.setUTCDate(oneMonthDate.getUTCDate() + 30);
        const nextMonthDate = new Date(now);
        nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
        replyText = ackPrefix + (isEnTurn ? 'What is the project completion date? (End Date):' : 'Project kab tak complete hona chahiye? (End Date batayein)');
        speechText = isEnTurn ? 'What is the project completion date?' : 'प्रोजेक्ट कब तक पूरा होना चाहिए?';
        speakTextHi = isEnTurn ? null : 'प्रोजेक्ट कब तक पूरा होना चाहिए?';
        chipsList = [
          { label: isEnTurn ? 'In 30 days' : 'Aaj se 30 din', action: { type: 'set', field: 'endDate', value: formatIstDate(oneMonthDate) } },
          { label: isEnTurn ? 'By next month' : 'Agle mahine tak', action: { type: 'set', field: 'endDate', value: formatIstDate(nextMonthDate) } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'priority') {
        replyText = ackPrefix + (isEnTurn ? 'What should be the project priority?' : 'Project ki priority kya rakhein?');
        speechText = isEnTurn ? 'What should be the project priority?' : 'प्रोजेक्ट की Priority क्या रखें?';
        speakTextHi = isEnTurn ? null : 'प्रोजेक्ट की Priority क्या रखें?';
        chipsList = [
          { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
          { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
          { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
        ];
      } else if (nextFieldKey === 'status') {
        replyText = ackPrefix + (isEnTurn ? 'What should be the project status?' : 'Project ka status kya rakhein?');
        speechText = isEnTurn ? 'What should be the project status?' : 'प्रोजेक्ट का स्टेटस क्या रखें?';
        speakTextHi = isEnTurn ? null : 'प्रोजेक्ट का स्टेटस क्या रखें?';
        chipsList = [
          { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
          { label: 'Planning', action: { type: 'set', field: 'status', value: 'Planning' } },
          { label: 'On Hold', action: { type: 'set', field: 'status', value: 'On Hold' } },
        ];
      } else if (nextFieldKey === 'members') {
        const mList = Array.isArray(currentDraft.members) ? currentDraft.members : [];
        if (mList.length > 0) {
          const names = mList.map(m => (typeof m === 'object' ? (m.name || m.label) : m)).join(', ');
          replyText = ackPrefix + (isEnTurn ? `Selected members: ${names}.\n\nWould you like to add any other member or click [Done]?` : `Selected members: ${names}.\n\nAur kisi member ko add karna hai ya [Done] dabayein?`);
          speechText = isEnTurn ? 'Would you like to add any other member or click Done?' : 'Aur kisi member ko add karna hai ya Done dabayein?';
          speakTextHi = isEnTurn ? null : 'और किसी member को add करना है या [Done] दबाएं?';
        } else {
          replyText = ackPrefix + (isEnTurn ? 'Who will be the project members? Specify names (you will be included):' : 'Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)');
          speechText = isEnTurn ? 'Who will be the project members? Specify names.' : 'प्रोजेक्ट में कौन-कौन सदस्य होंगे? नाम बताएं, आप खुद शामिल होंगे।';
          speakTextHi = isEnTurn ? null : 'प्रोजेक्ट में कौन-कौन सदस्य होंगे? नाम बताएं, आप खुद शामिल होंगे।';
        }
        chipsList = buildChips('create_project', 'members', {
          ...deps,
          companyUsers: deps.companyUsers,
          draft: currentDraft,
          user: req?.user,
          memberPage: currentDraft.memberPage || 0,
          language: userLang,
        });
      }
    } else if (activeIntent === 'task_project' && nextFieldKey === 'project') {
      chipsList = buildAccessibleProjectChips(accessibleProjects, 5);
    } else if (activeIntent === 'task_project' && nextFieldKey === 'priority') {
      chipsList = [
        { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
        { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
        { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
        { label: 'Baaki sab default', action: { type: 'skip_all' } },
      ];
    } else if (activeIntent === 'task_project' && nextFieldKey === 'status') {
      chipsList = [
        { label: 'Pending', action: { type: 'set', field: 'status', value: 'pending' } },
        { label: 'In Progress', action: { type: 'set', field: 'status', value: 'in progress' } },
        { label: 'Completed', action: { type: 'set', field: 'status', value: 'completed' } },
        { label: 'On Hold', action: { type: 'set', field: 'status', value: 'on hold' } },
        { label: 'Cancelled', action: { type: 'set', field: 'status', value: 'cancelled' } },
      ];
    } else if (activeIntent === 'task_project' && nextFieldKey === 'file') {
      chipsList = [
        { label: 'Nahi (Skip)', action: { type: 'skip', field: 'file' } },
        { label: 'Baaki sab default', action: { type: 'skip_all' } },
      ];
    } else if (isReAsk && typeof fieldConfig.reAskChips === 'function') {
      chipsList = fieldConfig.reAskChips(now, isEnTurn);
    } else if (typeof fieldConfig.chips === 'function') {
      chipsList = fieldConfig.chips(now, isEnTurn);
    }

    // Filter out chips for fields that are ALREADY filled in the draft
    chipsList = chipsList.filter((chip) => {
      const field = chip?.action?.field || chip?.field;
      if (field === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) return false;
      if (field === 'dueDate' && currentDraft.dueDate) return false;
      if (field === 'project' && currentDraft.projectId) return false;
      if (field === 'priority' && currentDraft.priority) return false;
      if (field === 'status' && currentDraft.status) return false;
      if (field === 'description' && currentDraft.description !== null && currentDraft.description !== undefined) return false;
      if (field === 'title' && currentDraft.title) return false;
      return true;
    });

        // Offer [Khud ke liye] [Kisi aur ke liye] ONLY when user typed generic task and intent is not yet chosen
    const isIntentFixed = Boolean(currentDraft.intent && ['self_task', 'task_assigned_user', 'task_project', 'create_project', 'create_client', 'create_client_task', 'create_client_plan'].includes(currentDraft.intent));
    if (!isIntentFixed && canAssignOthers && !currentDraft.taskFor && nextFieldKey !== 'assignee') {
      chipsList = [
        { label: 'Khud ke liye', action: { type: 'set_intent', intent: 'self_task' } },
        { label: 'Kisi aur ke liye', action: { type: 'set_intent', intent: 'task_assigned_user' } },
        ...chipsList,
      ];
    }
    // Runtime chips guard (Item 2)
    chipsList = assertChipsAllowed(currentDraft.intent, nextFieldKey, chipsList);

    if (isEnTurn && Array.isArray(chipsList)) {
      chipsList = chipsList.map(c => {
        let lbl = c.label || '';
        if (lbl === 'Baaki sab default') return { ...c, label: 'Skip remaining' };
        if (lbl === 'Koi nahi / Skip') return { ...c, label: 'Skip' };
        if (lbl === 'Khud ke liye') return { ...c, label: 'For myself' };
        if (lbl === 'Kisi aur ke liye') return { ...c, label: 'For someone else' };
        if (lbl === 'Haan, create karo') return { ...c, label: 'Yes, create it' };
        if (lbl === 'Kuch badalna hai') return { ...c, label: 'Edit' };
        if (lbl.startsWith('Aaj shaam')) return { ...c, label: lbl.replace('Aaj shaam', 'Today') };
        if (lbl.startsWith('Kal subah')) return { ...c, label: lbl.replace('Kal subah', 'Tomorrow') };
        if (lbl.startsWith('Kal shaam')) return { ...c, label: lbl.replace('Kal shaam', 'Tomorrow') };
        return c;
      });
    }

    if (ackPrefix && !replyText.startsWith(ackPrefix)) {
      replyText = ackPrefix + replyText;
    }
    if (notices.length > 0 && !replyText.includes(notices[0])) {
      replyText = notices.join(' ') + '\n\n' + replyText;
    }

    // Invariant Loop Guard: agent must NEVER return the exact same reply and exact same chips twice in a row for two different user inputs (except validation re-ask)
    const currentChipsKey = (chipsList || []).map((c) => c.label).sort().join('|');
    const isValidationReAsk = notices.some((n) => n.includes('format galat') || n.includes('digits ka hona chahiye') || n.includes('zaroori hai'));
    if (
      !isValidationReAsk &&
      currentDraft._lastReply === replyText &&
      currentDraft._lastChipsKey === currentChipsKey &&
      rawMessage &&
      currentDraft._lastUserMsg &&
      rawMessage.trim().toLowerCase() !== currentDraft._lastUserMsg.trim().toLowerCase()
    ) {
      if (currentDraft.intent === 'create_client' && nextFieldKey === 'more_details') {
        currentDraft.moreDetailsDone = true;
        currentDraft.activeDetailsGroup = null;
        currentDraft.activeGroupField = null;
        nextFieldKey = null;
      } else {
        replyText = `Mujhe samajh nahi aaya. ${replyText}`;
      }
    }

    if (nextFieldKey) {
      currentDraft._lastReply = replyText;
      currentDraft._lastChipsKey = currentChipsKey;
      currentDraft._lastUserMsg = rawMessage ? rawMessage.trim() : '';

      return {
        success: true,
        status: 'needs_input',
        field: nextFieldKey,
        reply: replyText,
        speech: speechText,
        speakText: isEnTurn ? (speechText || replyText) : (fieldConfig?.question?.speakText || replyText),
        speakTextHi: isEnTurn ? null : (speakTextHi || fieldConfig?.question?.speakTextHi || speechText || replyText),
        language: userLang,
        draft: currentDraft,
        missing: [nextFieldKey],
        chips: chipsList,
        candidates,
        notices,
        progress: { done, total },
        canAssignOthers,
        intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
        meta: { model: modelName },
      };
    }
  }

  // Strict Draft Validation via Form Registry before declaring READY
  const activeFormConfig = FORM_REGISTRY[currentDraft.intent] || FORM_REGISTRY.self_task;
  const draftValidation = activeFormConfig.validateDraft
    ? activeFormConfig.validateDraft(currentDraft, currentProject)
    : { valid: true };

  if (!draftValidation.valid) {
    const invalidField = draftValidation.field || 'assignee';
    currentDraft.asked = currentDraft.asked.filter((f) => f !== invalidField);

    let validationChips = [];
    if (invalidField === 'assignee' && currentProject) {
      validationChips = (currentProject.users || []).slice(0, 8).map((m) => ({
        label: m.name,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id || m) },
      }));
      if (formatProjectStatus(currentDraft.status) !== 'in progress') {
        validationChips.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
      }
      validationChips.push({ label: 'Cancel', action: { type: 'cancel' } });
    }

    const replyMsg = `${draftValidation.reason}. Kripya ${invalidField === 'assignee' ? 'assignee' : invalidField} select karein:`;
    const speechMsg = invalidField === 'assignee'
      ? 'कृपया इस प्रोजेक्ट के किसी सदस्य को असाइन करें।'
      : 'कृपया आवश्यक जानकारी बताएं।';

    return {
      success: true,
      status: 'needs_input',
      field: invalidField,
      reply: replyMsg,
      speech: speechMsg,
      speakText: speechMsg || replyMsg,
      draft: currentDraft,
      missing: [invalidField],
      chips: validationChips,
      candidates: [],
      notices,
      progress: { done, total },
      canAssignOthers,
      intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
      meta: { model: modelName },
    };
  }

  // Pre-ready guard: Every mentioned name must be resolved or removed_by_user
  if (!isAssigneeLedgerComplete(currentDraft)) {
    const nextUnresolved = getFirstUnresolvedLedgerEntry(currentDraft);
    if (nextUnresolved) {
      const promptObj = buildUnresolvedEntryPrompt(nextUnresolved);
      return {
        success: true,
        status: promptObj.status,
        field: 'assignee',
        reply: promptObj.reply,
        speech: promptObj.speech,
        speakText: promptObj.speech || promptObj.reply,
        draft: currentDraft,
        missing: ['assigneeId'],
        chips: promptObj.chips,
        candidates: nextUnresolved.candidates || [],
        notices,
        canAssignOthers,
        progress: { done: 0, total: 10 },
        payload: null,
        preview: null,
        intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
        meta: { model: modelName },
      };
    }
  }

  // All fields are handled -> Status: READY
  const cleanedCheckpoints = getCleanCheckpoints(currentDraft.checkpoints);
  const isFinalOthers = Boolean(
    (currentDraft.assigneeId || (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0)) &&
    currentDraft.taskFor === 'others'
  );
  const taskFor = currentDraft.intent === 'task_project' ? 'project' : (isFinalOthers ? 'others' : 'self');

  let payload;
  let preview;

  if (currentDraft.intent === 'create_client_task') {
    payload = FORM_REGISTRY.create_client_task.buildPayload(currentDraft, req?.user || {});
    preview = FORM_REGISTRY.create_client_task.buildPreview(currentDraft, req?.user || {});
  } else if (currentDraft.intent === 'create_client_plan') {
    payload = FORM_REGISTRY.create_client_plan.buildPayload(currentDraft, req?.user || {});
    preview = FORM_REGISTRY.create_client_plan.buildPreview(currentDraft);
  } else if (currentDraft.intent === 'create_client') {
    payload = FORM_REGISTRY.create_client.buildPayload(currentDraft, req?.user || {}, {
      companyCode: req?.user?.companyCode,
      branchId: req?.user?.branchId || currentDraft.branchId,
    });
    preview = FORM_REGISTRY.create_client.buildPreview(currentDraft, req?.user || {});
  } else if (currentDraft.intent === 'create_project') {
    currentDraft.status = currentDraft.status || 'Active';
    currentDraft.priority = currentDraft.priority || 'Medium';
    payload = FORM_REGISTRY.create_project.buildPayload(currentDraft, req?.user || {}, {
      branchId: req?.user?.branchId || currentDraft.branchId,
      companyIdentifier: req?.user?.companyIdentifier,
    });
    preview = FORM_REGISTRY.create_project.buildPreview(currentDraft, req?.user || {});
  } else if (currentDraft.intent === 'task_project') {
    const verifiedProj = accessibleProjects.find((p) => idsEqual(p._id, currentDraft.projectId));
    if (!verifiedProj) {
      notices.push('Project access verify nahi ho saka.');
    }
    payload = FORM_REGISTRY.task_project.buildPayload(currentDraft);
    preview = FORM_REGISTRY.task_project.buildPreview(currentDraft);
  } else if (isFinalOthers) {
    payload = FORM_REGISTRY.task_assigned_user.buildPayload(currentDraft);
    preview = FORM_REGISTRY.task_assigned_user.buildPreview(currentDraft);
  } else {
    payload = FORM_REGISTRY.self_task.buildPayload(currentDraft);
    preview = FORM_REGISTRY.self_task.buildPreview(currentDraft);
  }

  const readyConfig = TASK_FIELDS.ready;

  if (wantsEditPrompt) {
    const editChips = currentDraft.intent === 'task_project'
      ? [
        { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
        { label: 'Date badlo', action: { type: 'ask', field: 'dueDate' } },
        { label: 'Reminder badlo', action: { type: 'ask', field: 'reminder' } },
        { label: 'Haan, create karo', action: { type: 'confirm' } },
      ]
      : (currentDraft.intent === 'create_project'
        ? [
          { label: 'Status badlo', action: { type: 'ask', field: 'status' } },
          { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
          { label: 'Dates badlo', action: { type: 'ask', field: 'startDate' } },
          { label: 'Name badlo', action: { type: 'ask', field: 'name' } },
          { label: 'Haan, create kar do', action: { type: 'confirm' } },
        ]
        : (currentDraft.intent === 'create_client'
          ? [
            { label: 'Status badlo', action: { type: 'ask', field: 'status' } },
            { label: 'Dates badlo', action: { type: 'ask', field: 'subscriptionStartDate' } },
            { label: 'Haan, create karo', action: { type: 'confirm' } },
          ]
          : [
            { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
            { label: 'Date/Time badlo', action: { type: 'ask', field: 'dueDateTime' } },
            { label: 'Reminder badlo', action: { type: 'ask', field: 'reminder' } },
            { label: 'Haan, create karo', action: { type: 'confirm' } },
          ]));

    return {
      success: true,
      status: 'ready',
      field: 'ready',
      reply: 'Ji batayein kya changes karne hain? Main kar dungi.',
      speech: 'जी बताएं क्या बदलाव करने हैं? मैं कर दूंगी।',
      speakText: 'Ji batayein kya changes karne hain? Main kar dungi.',
      draft: currentDraft,
      missing: [],
      chips: editChips,
      candidates: [],
      notices,
      progress: { done: total, total },
      canAssignOthers,
      payload,
      preview,
      intent: { type: 'confirm_no' },
      meta: { model: modelName },
    };
  }

  const modifiedFields = [];
  if (initialValues.dueDateTime && currentDraft.dueDateTime && initialValues.dueDateTime !== currentDraft.dueDateTime) {
    const formattedDue = formatHumanIstDate(currentDraft.dueDateTime);
    modifiedFields.push({ key: 'dueDateTime', labelHinglish: `due time (${formattedDue})`, labelHindi: `ड्यू टाइम (${formattedDue})` });
  }
  if (initialValues.dueDate && currentDraft.dueDate && initialValues.dueDate !== currentDraft.dueDate) {
    const formattedDue = formatHumanIstDate(currentDraft.dueDate);
    modifiedFields.push({ key: 'dueDate', labelHinglish: `due date (${formattedDue})`, labelHindi: `ड्यू डेट (${formattedDue})` });
  }
  if (initialValues.priority && currentDraft.priority && initialValues.priority !== currentDraft.priority) {
    modifiedFields.push({ key: 'priority', labelHinglish: `priority (${currentDraft.priority})`, labelHindi: `प्रायोरिटी (${currentDraft.priority})` });
  }
  if (initialValues.title && currentDraft.title && initialValues.title !== currentDraft.title) {
    modifiedFields.push({ key: 'title', labelHinglish: `title ("${currentDraft.title}")`, labelHindi: `नाम ("${currentDraft.title}")` });
  }
  if (initialValues.description !== null && currentDraft.description !== null && initialValues.description !== currentDraft.description) {
    modifiedFields.push({ key: 'description', labelHinglish: 'description', labelHindi: 'विवरण' });
  }
  if (initialValues.status && currentDraft.status && initialValues.status !== currentDraft.status) {
    modifiedFields.push({ key: 'status', labelHinglish: `status (${currentDraft.status})`, labelHindi: `स्टेटस (${currentDraft.status})` });
  }
  if (initialValues.reminder !== null && currentDraft.reminder !== null && (initialValues.reminder !== currentDraft.reminder || initialValues.repeatIntervalMinutes !== currentDraft.repeatIntervalMinutes || initialValues.minutesBeforeDue !== currentDraft.minutesBeforeDue || initialValues.reminderOption !== currentDraft.reminderOption)) {
    modifiedFields.push({ key: 'reminder', labelHinglish: `reminder (${getReminderPreviewText(currentDraft)})`, labelHindi: 'रिमाइंडर' });
  }
  if (initialValues.assigneeId && currentDraft.assigneeId && initialValues.assigneeId !== currentDraft.assigneeId) {
    modifiedFields.push({ key: 'assignee', labelHinglish: 'assignee', labelHindi: 'कर्मचारी' });
  }
  if (initialValues.projectId && currentDraft.projectId && initialValues.projectId !== currentDraft.projectId) {
    modifiedFields.push({ key: 'project', labelHinglish: `project ("${currentDraft.projectName}")`, labelHindi: `प्रोजेक्ट ("${currentDraft.projectName}")` });
  }

  let readyChips = null;
  let finalReply = ackPrefix + (userLang === 'en' ? (readyConfig.question.replyEn || 'All details are ready. Shall I create this task?') : readyConfig.question.reply);
  let readySpeech = speechPrefix
    ? `${speechPrefix}${userLang === 'en' ? (readyConfig.question.speechEn || 'All details are ready. Shall I create this task?') : readyConfig.question.speech}`
    : (userLang === 'en'
      ? (currentDraft.title ? `Task "${currentDraft.title}" is ready. Shall I create it?` : (readyConfig.question.speechEn || 'All details are ready. Shall I create this task?'))
      : (currentDraft.title ? `टास्क "${currentDraft.title}" तैयार है। ${readyConfig.question.speech}` : readyConfig.question.speech));
  let finalSpeech = readySpeech;
  if (userLang === 'en') {
    readyChips = [
      { label: 'Yes, create it', action: { type: 'confirm' } },
      { label: 'Edit', action: { type: 'edit' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  
  if (currentDraft.intent === 'create_client_task') {
    if (userLang === 'en') {
      finalReply = ackPrefix + `Task "${currentDraft.title}" for client "${currentDraft.client}" (${currentDraft.service}) is ready.\n\nShall I create it?`;
      finalSpeech = `Task "${currentDraft.title}" is ready. Shall I create it?`;
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      finalReply = ackPrefix + `Client "${currentDraft.client}" ki "${currentDraft.service}" service ke liye task "${currentDraft.title}" ready hai.\n\nKya ise create kar doon?`;
      finalSpeech = `टास्क "${currentDraft.title}" तैयार है। क्या मैं बना दूं?`;
      readyChips = [
        { label: 'Haan, create karo', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else if (currentDraft.intent === 'create_client_plan') {
    const servicesStr = Array.isArray(currentDraft.services) && currentDraft.services.length > 0
      ? currentDraft.services.map(s => typeof s === 'string' ? s : (s.service || s.name || '')).join(', ')
      : (userLang === 'en' ? 'None' : 'Koi nahi');
    const priceStr = currentDraft.price !== undefined && currentDraft.price !== null ? ('₹' + Number(currentDraft.price).toLocaleString('en-IN')) : 'Free';
    if (userLang === 'en') {
      finalReply = ackPrefix + 'Client Plan "' + currentDraft.name + '" draft is ready.\nPrice: ' + priceStr + '\nDuration: ' + (currentDraft.months || 1) + ' Month(s)\nStatus: ' + (currentDraft.status || 'Active') + '\nServices: ' + servicesStr + '\n\nShall I create it?';
      finalSpeech = 'Client Plan "' + currentDraft.name + '" draft is ready. Shall I create it?';
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      finalReply = ackPrefix + 'Client Plan "' + currentDraft.name + '" ka draft taiyar hai.\nPrice: ' + priceStr + '\nDuration: ' + (currentDraft.months || 1) + ' Month(s)\nStatus: ' + (currentDraft.status || 'Active') + '\nServices: ' + servicesStr + '\n\nKya main create kar doon?';
      finalSpeech = 'क्लाइंट प्लान "' + currentDraft.name + '" का ड्राफ्ट तैयार है। क्या मैं बना दूं?';
      readyChips = [
        { label: 'Create karo', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else
  if (currentDraft.intent === 'create_client') {
    const { maskEmail } = require('./clientSlotFiller');
    const emailNotice = currentDraft.email
      ? (userLang === 'en' ? `Upon creation, login credentials will be emailed to: ${maskEmail(currentDraft.email)}` : `Create karne par client ko login details ka email jayega: ${maskEmail(currentDraft.email)}`)
      : (userLang === 'en' ? 'No email provided; an auto-generated login will be created.' : 'Email nahi diya gaya, system auto-generated login banayega');
    let servicesLine = '';
    if (Array.isArray(currentDraft.services) && currentDraft.services.length > 0) {
      servicesLine = '\nServices: ' + currentDraft.services.join(', ');
    }
    let planLine = '';
    if (currentDraft.clientPlanName || currentDraft.clientPlanId) {
      const taskCount = currentDraft.clientPlanTasksCount;
      const countStr = typeof taskCount === 'number' && taskCount > 0 ? (taskCount + ' ') : '';
      planLine = '\nPlan: ' + (currentDraft.clientPlanName || 'Plan');
    }
    let logoLine = '';
    if (currentDraft.companyLogoName || currentDraft.companyLogo) {
      logoLine = '\nLogo: ' + (currentDraft.companyLogoName || currentDraft.companyLogo);
    }
    if (userLang === 'en') {
      finalReply = ackPrefix + 'Client "' + currentDraft.client + '" (' + currentDraft.company + ', ' + currentDraft.city + ') draft is ready.' + servicesLine + planLine + logoLine + '\n\n' + emailNotice + '\n\nShall I create it?';
      finalSpeech = `Client "${currentDraft.client}" draft is ready. Shall I create it?`;
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      finalReply = ackPrefix + 'Client "' + currentDraft.client + '" (' + currentDraft.company + ', ' + currentDraft.city + ') ka draft taiyar hai.' + servicesLine + planLine + logoLine + '\n\n' + emailNotice + '\n\nKya main create kar doon?';
      finalSpeech = `क्लाइंट "${currentDraft.client}" का ड्राफ्ट तैयार है। क्या मैं बना दूं?`;
      readyChips = [
        { label: 'Create karo', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else if (currentDraft.intent === 'create_project') {
    const memberCount = Array.isArray(currentDraft.members) ? currentDraft.members.length : 0;
    if (userLang === 'en') {
      const memberStr = memberCount > 0 ? `Team members (${memberCount + 1}) included (including yourself)` : 'You will be a member';
      finalReply = ackPrefix + `New project "${currentDraft.name}" draft is ready. Start date: ${currentDraft.startDate}, End date: ${currentDraft.endDate}. ${memberStr}.\n\nShall I create it?`;
      finalSpeech = `New project "${currentDraft.name}" draft is ready. Shall I create it?`;
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      const memberStr = memberCount > 0 ? `Team members (${memberCount + 1}) add ho gaye hain (aap bhi member honge)` : 'Aap member honge';
      finalReply = ackPrefix + `Naya project "${currentDraft.name}" create karne ke liye draft tayar hai. Start date: ${currentDraft.startDate}, End date: ${currentDraft.endDate}. ${memberStr}. Kya main create kar doon?`;
      finalSpeech = `नया प्रोजेक्ट "${currentDraft.name}" बनाने के लिए तैयार है। आप भी सदस्य होंगे। क्या मैं बना दूं?`;
      readyChips = [
        { label: 'Haan, create kar do', action: { type: 'confirm' } },
        { label: 'Edit karein', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else if (currentDraft.intent === 'task_project' && currentDraft.projectName) {
    const last6 = currentDraft.projectId ? String(currentDraft.projectId).slice(-6) : '';
    const dateStr = currentDraft.projectStartDate ? formatCandidateDate(currentDraft.projectStartDate) : '';
    const distinguishingSuffix = (currentDraft.showDistinguishing && last6)
      ? ` (Start: ${dateStr || 'No date'}, #${last6})`
      : '';
    const projectDisplayTitle = `${currentDraft.projectName}${distinguishingSuffix}`;

    const assigneesList = Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0
      ? currentDraft.assignees
      : (currentDraft.assigneeId ? [{ name: currentDraft.assigneeName || currentDraft.assigneeLabel, id: currentDraft.assigneeId }] : []);

    let whoHinglish = '';
    let whoHindi = '';
    let whoEnglish = '';
    if (assigneesList.length > 1) {
      const names = assigneesList.map(a => a.name || a.label);
      if (names.length === 2) {
        whoHinglish = `${names[0]} aur ${names[1]}`;
        whoHindi = `${names[0]} और ${names[1]}`;
        whoEnglish = `${names[0]} and ${names[1]}`;
      } else {
        whoHinglish = `${names.slice(0, -1).join(', ')} aur ${names[names.length - 1]}`;
        whoHindi = `${names.slice(0, -1).join(', ')} और ${names[names.length - 1]}`;
        whoEnglish = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      }
    } else if (assigneesList.length === 1) {
      whoHinglish = assigneesList[0].name || currentDraft.assigneeName || currentDraft.assigneeLabel;
      whoHindi = whoHinglish;
      whoEnglish = whoHinglish;
    }

    if (userLang === 'en') {
      if (whoEnglish) {
        finalReply = ackPrefix + `Task "${currentDraft.title}" assigned to ${whoEnglish} in project "${projectDisplayTitle}" is ready.\n\nShall I create it?`;
        finalSpeech = `Task "${currentDraft.title}" assigned to ${whoEnglish} is ready. Shall I create it?`;
      } else {
        finalReply = ackPrefix + `Task "${currentDraft.title}" in project "${projectDisplayTitle}" is ready.\n\nShall I create it?`;
        finalSpeech = `Task "${currentDraft.title}" is ready. Shall I create it?`;
      }
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      if (whoHinglish) {
        finalReply = ackPrefix + `Project "${projectDisplayTitle}" ke andar ${whoHinglish} ko task "${currentDraft.title}" assign karne ke liye draft tayar hai. Kya main create kar doon?`;
        finalSpeech = `प्रोजेक्ट "${currentDraft.projectName}" में ${whoHindi} को टास्क "${currentDraft.title}" असाइन करने के लिए तैयार है। क्या मैं बना दूं?`;
      } else {
        finalReply = ackPrefix + `Project "${projectDisplayTitle}" ke andar task "${currentDraft.title}" tayar hai. Kya main create kar doon?`;
        finalSpeech = `प्रोजेक्ट "${currentDraft.projectName}" में टास्क "${currentDraft.title}" तैयार है। क्या मैं बना दूं?`;
      }
      readyChips = [
        { label: 'Haan, create karo', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else if (currentDraft.intent === 'task_assigned_user' && (currentDraft.assignees?.length || currentDraft.assigneeName || currentDraft.assigneeLabel)) {
    let whoHinglish = '';
    let whoHindi = '';
    let whoEnglish = '';
    if (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 1) {
      const names = currentDraft.assignees.map(a => a.name || a.label);
      if (names.length === 2) {
        whoHinglish = `${names[0]} aur ${names[1]}`;
        whoHindi = `${names[0]} और ${names[1]}`;
        whoEnglish = `${names[0]} and ${names[1]}`;
      } else {
        whoHinglish = `${names.slice(0, -1).join(', ')} aur ${names[names.length - 1]}`;
        whoHindi = `${names.slice(0, -1).join(', ')} और ${names[names.length - 1]}`;
        whoEnglish = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      }
    } else {
      whoHinglish = currentDraft.assigneeName || currentDraft.assigneeLabel;
      whoHindi = whoHinglish;
      whoEnglish = whoHinglish;
    }
    if (userLang === 'en') {
      finalReply = ackPrefix + `Task "${currentDraft.title}" assigned to ${whoEnglish} is ready.\n\nShall I create it?`;
      finalSpeech = `Task "${currentDraft.title}" assigned to ${whoEnglish} is ready. Shall I create it?`;
      readyChips = [
        { label: 'Yes, create it', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    } else {
      finalReply = ackPrefix + `${whoHinglish} ko task "${currentDraft.title}" assign karne ke liye draft tayar hai. Kya main create kar doon?`;
      finalSpeech = `${whoHindi} को टास्क "${currentDraft.title}" असाइन करने के लिए तैयार है। क्या मैं बना दूं?`;
      if (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 1) {
        finalSpeech = `${whoHinglish} ko task assign karna hai. Create kar doon?`;
      }
      readyChips = [
        { label: 'Create karo', action: { type: 'confirm' } },
        { label: 'Edit', action: { type: 'edit' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
  } else if (userLang === 'en') {
    finalReply = ackPrefix + `Personal task "${currentDraft.title}" is ready.\n\nShall I create it?`;
    finalSpeech = `Personal task "${currentDraft.title}" is ready. Shall I create it?`;
    readyChips = [
      { label: 'Yes, create it', action: { type: 'confirm' } },
      { label: 'Edit', action: { type: 'edit' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (modifiedFields.length > 0) {
    const labelsHinglish = modifiedFields.map((f) => f.labelHinglish).join(', ');
    const labelsHindi = modifiedFields.map((f) => f.labelHindi).join(', ');
    const labelsEnglish = modifiedFields.map((f) => f.key).join(', ');
    if (userLang === 'en') {
      if (currentDraft.intent === 'create_project') {
        finalReply = `Updated ${labelsEnglish}. Shall I create the new project "${currentDraft.name}"?`;
        finalSpeech = `Updated ${labelsEnglish}. Shall I create the new project?`;
      } else if (currentDraft.intent === 'create_client') {
        finalReply = `Updated ${labelsEnglish}. Shall I create the new client "${currentDraft.client}"?`;
        finalSpeech = `Updated ${labelsEnglish}. Shall I create the new client?`;
      } else {
        finalReply = `Updated ${labelsEnglish}. Shall I create the task now?`;
        finalSpeech = `Updated ${labelsEnglish}. Shall I create the task now?`;
      }
    } else {
      if (currentDraft.intent === 'create_project') {
        finalReply = `Ji aapka ${labelsHinglish} change kar diya hai. Naya project "${currentDraft.name}" create kar doon?`;
        finalSpeech = `जी आपका ${labelsHindi} बदल दिया है। क्या मैं नया प्रोजेक्ट बना दूं?`;
      } else if (currentDraft.intent === 'create_client') {
        finalReply = `Ji aapka ${labelsHinglish} change kar diya hai. Naya client "${currentDraft.client}" create kar doon?`;
        finalSpeech = `जी आपका ${labelsHindi} बदल दिया है। क्या मैं नया क्लाइंट बना दूं?`;
      } else {
        finalReply = `Ji aapka ${labelsHinglish} change kar diya hai. Kya main task create kar doon?`;
        finalSpeech = `जी आपका ${labelsHindi} बदल दिया है। क्या मैं टास्क क्रिएट कर दूं?`;
      }
    }
  }

  const unhandledUnresolved = (currentDraft.assigneeLedger || []).filter(
    (e) => (e.status === 'not_found' || e.status === 'not_member') && !e.reported
  );
  if (unhandledUnresolved.length > 0) {
    unhandledUnresolved.forEach((e) => {
      e.reported = true;
      const msg = e.status === 'not_member'
        ? `"${e.displayName || e.rawName}" aapke branch ya department scope se bahar hain.`
        : `"${e.displayName || e.rawName}" naam ka koi employee nahi mila. Kripya sahi naam batayein.`;
      if (!notices.includes(msg)) notices.push(msg);
    });
  }
  if (notices.length > 0 && !finalReply.includes(notices[0])) {
    finalReply = notices.join(' ') + '\n\n' + finalReply;
  }

  currentDraft._lastReply = finalReply;
  currentDraft._lastChipsKey = (readyChips || []).map((c) => c.label).sort().join('|');
  currentDraft._lastUserMsg = rawMessage ? rawMessage.trim() : '';

  return {
    success: true,
    status: 'ready',
    field: 'ready',
    reply: finalReply,
    speech: finalSpeech,
    speakText: finalReply ? finalReply.split('\n')[0] : (userLang === 'en' ? 'Draft is ready.' : 'Draft taiyar hai.'),
    speakTextHi: userLang === 'en' ? null : (currentDraft.intent === 'create_client' ? `Client "${currentDraft.client}" का Draft तैयार है। क्या मैं create कर दूं?` : (finalSpeech || 'Draft तैयार है।')),
    language: userLang,
    draft: currentDraft,
    missing: [],
    chips: (readyChips && readyChips.length > 0) ? readyChips : (typeof readyConfig.chips === 'function' ? readyConfig.chips() : []),
    candidates: [],
    notices,
    progress: { done: total, total },
    canAssignOthers,
    payload,
    preview,
    intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
    meta: { model: modelName },
  };
}

module.exports = {
  parseTaskRequest,
  formatHumanIstDate,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getWelcomeMessage,
  resolveUserAllowedIntents,
  getPermissionDeniedReply,
  detectMessageLanguage,
  isChitChatOrGreeting,
  getChitChatReply,
  isOutOfScopeQuery,
  getOutOfScopeReply,
  isCrmQuery,
  handleCrmQuery,
  isCrmTaskUpdate,
  handleCrmUpdate,
};