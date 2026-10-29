const path = require('path');
const dotenv = require('dotenv');
const { ChatGroq } = require('@langchain/groq');

const DEFAULT_MODEL = 'openai/gpt-oss-20b';

const getModelName = () => {
  return (process.env.GROQ_MODEL && process.env.GROQ_MODEL.trim()) || DEFAULT_MODEL;
};

let envAttempted = false;

const hasLLM = () => {
  if (!envAttempted && (!process.env.GROQ_API_KEY || !process.env.GROQ_API_KEY.trim())) {
    envAttempted = true;
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  }
  const key = process.env.GROQ_API_KEY;
  if (!key || !key.trim()) {
    const error = new Error('Groq API key is not configured.');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }
  return true;
};

const getModel = ({ temperature = 0, maxTokens = 1500, reasoningEffort = 'low' } = {}) => {
  hasLLM();
  const apiKey = process.env.GROQ_API_KEY.trim();

  return new ChatGroq({
    apiKey,
    model: getModelName(),
    temperature,
    maxTokens,
    reasoningEffort,
    maxRetries: 1,
    timeout: 20000,
  });
};

module.exports = {
  getModel,
  getLLM: getModel,
  hasLLM,
  getModelName,
  DEFAULT_MODEL,
};
