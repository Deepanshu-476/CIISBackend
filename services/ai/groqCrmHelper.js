const axios = require('axios');

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PRIMARY_MODEL = 'qwen/qwen3.8-27b';
const FALLBACK_MODEL = 'openai/gpt-oss-20b';

const path = require('path');
const { executeWithGroqFallback, getGroqApiKeys } = require('./groqKeyManager');

function getGroqApiKey() {
  const keys = getGroqApiKeys();
  return keys[0] || '';
}

/**
 * Call Groq chat completions with key rotation (primary -> secondary) and fallback models.
 */
async function callGroq({ systemPrompt, userMessage, maxTokens = 250, temperature = 0.2 }) {
  const keys = getGroqApiKeys();
  if (keys.length === 0) return null;

  const modelsToTry = [PRIMARY_MODEL, 'openai/gpt-oss-120b', FALLBACK_MODEL];

  try {
    return await executeWithGroqFallback(async (apiKey) => {
      for (const model of modelsToTry) {
        try {
          const res = await axios.post(
            GROQ_CHAT_URL,
            {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
              ],
              max_tokens: maxTokens,
              temperature
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 7000
            }
          );

          const content = res.data?.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } catch (err) {
          const status = err.response?.status;
          // If 429 or auth error, throw so executeWithGroqFallback rotates to secondary key
          if (status === 429 || status === 401 || status === 403) {
            throw err;
          }
          console.warn(`[groqCrmHelper] Model ${model} failed:`, err.response?.data?.error?.message || err.message);
        }
      }
      return null;
    });
  } catch (err) {
    console.warn('[groqCrmHelper] All keys/models failed:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/**
 * Intelligent CRM Query & Chit-Chat Handler powered by Groq.
 * Returns null if LLM fails or is disabled, allowing deterministic fallback.
 */
async function answerWithGroqCRM({
  message,
  user = {},
  accessibleProjects = [],
  accessibleClients = [],
  companyUsers = [],
  tasks = [],
  clientPlans = [],
  services = [],
  language = 'hinglish'
}) {
  const apiKey = getGroqApiKey();
  if (!apiKey || !message || typeof message !== 'string') return null;

  const rawName = String(user?.name || user?.userName || '').trim();
  const userName = rawName ? rawName.split(/\s+/)[0] : 'User';

  // Build compact member map
  const userMap = new Map();
  if (Array.isArray(companyUsers)) {
    for (const u of companyUsers) {
      const id = String(u._id || u.id || '');
      if (id) userMap.set(id, u.name || u.userName || 'Member');
    }
  }

  // Format projects
  const projectSummary = Array.isArray(accessibleProjects) && accessibleProjects.length > 0
    ? accessibleProjects.slice(0, 50).map(p => {
        const pName = p.projectName || p.name || 'Project';
        const status = p.status || 'Active';
        const memberNames = Array.isArray(p.users)
          ? p.users.map(u => {
              if (typeof u === 'string') return userMap.get(u) || u;
              return u.name || userMap.get(String(u._id || u.id)) || 'Member';
            }).filter(Boolean).join(', ')
          : 'None';
        const memberCount = Array.isArray(p.users) ? p.users.length : 0;
        return `- Project '${pName}': Status: ${status}, Members (${memberCount}): ${memberNames || 'None'}`;
      }).join('\n')
    : 'No projects registered.';

  // Format clients
  const clientSummary = Array.isArray(accessibleClients) && accessibleClients.length > 0
    ? accessibleClients.slice(0, 100).map(c => {
        const cName = c.client || c.name || 'Client';
        const comp = c.company ? ` (${c.company})` : '';
        const sList = Array.isArray(c.services)
          ? c.services.map(s => typeof s === 'string' ? s : (s.service || s.name)).filter(Boolean).join(', ')
          : 'None';
        let pName = 'None';
        if (c.activeClientPlan) {
          if (typeof c.activeClientPlan === 'object' && c.activeClientPlan.name) {
            pName = c.activeClientPlan.name + (c.activeClientPlan.price ? ` (₹${Number(c.activeClientPlan.price).toLocaleString('en-IN')})` : '');
          } else {
            const found = (clientPlans || []).find(p => String(p._id || p.id) === String(c.activeClientPlan));
            if (found) pName = found.name + (found.price ? ` (₹${Number(found.price).toLocaleString('en-IN')})` : '');
          }
        }
        return `- Client '${cName}'${comp}: Active Plan: ${pName}, Services: ${sList}, Status: ${c.status || 'Active'}`;
      }).join('\n')
    : 'No clients registered.';

  // Format tasks
  const taskSummary = Array.isArray(tasks) && tasks.length > 0
    ? tasks.slice(0, 50).map(t => {
        const title = t.title || t.name || 'Task';
        const st = t.overallStatus || t.status || 'pending';
        const prio = t.priority || 'medium';
        return `- Task '${title}': Status: ${st}, Priority: ${prio}`;
      }).join('\n')
    : 'No recent tasks.';

  const isEn = language === 'en';

  const systemPrompt = `You are the CIIS AI CRM Assistant.
Your job is to assist ${userName} with their company CRM tasks, projects, clients, and inquiries.
Tone: Helpful, polite, natural, professional, concise.
Language: Answer in ${isEn ? 'English' : 'conversational Hinglish (natural Hindi written in English/Latin script)'}.

Rules:
1. Always base answers strictly on the CRM Context below. Do not fabricate projects or clients.
2. When asked about projects (e.g. status, members, list), provide exact details. If asked who is in a project or member count, list their names.
3. When asked about clients, services, or plans, check the clients' active plans and services from the CRM Context and answer directly.
4. If the user shares feelings or moods (e.g. tired, happy, good morning), acknowledge empathetically in 1 short sentence and ask how you can assist with their CRM work.
5. If the user asks about completely unrelated topics (cooking recipes, political figures, medicines, off-topic trivia), politely state that you are the CIIS CRM Assistant and only assist with company CRM tasks, projects, and clients.
6. Keep responses crisp and format list items cleanly using numbered lists (1. **Item Name**) or bullet points. Always wrap bold item names in clean double asterisks (**Item Name**). Never leave dangling or unmatched asterisks.
7. NEVER say that you cannot create tasks or that you don't have permission to modify data. You are part of the CIIS Assistant system that creates and assigns tasks. If asked to create a task, project, or client, acknowledge enthusiastically and invite them to provide the title or details.`;

  const userMessage = `CRM Context for ${userName}:
Projects:
${projectSummary}

Clients:
${clientSummary}

Recent Tasks:
${taskSummary}

User Query: ${message}`;

  return await callGroq({ systemPrompt, userMessage, maxTokens: 250, temperature: 0.2 });
}

module.exports = {
  callGroq,
  answerWithGroqCRM
};
