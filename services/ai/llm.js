const path = require('path');
const dotenv = require('dotenv');
const { ChatGroq } = require('@langchain/groq');
const { getGroqApiKeys, getOrderedKeys } = require('./groqKeyManager');

const DEFAULT_MODEL = 'qwen/qwen3.8-27b';

const getModelName = () => {
  return (process.env.GROQ_MODEL && process.env.GROQ_MODEL.trim()) || DEFAULT_MODEL;
};

let envAttempted = false;

const hasLLM = () => {
  if (!envAttempted) {
    envAttempted = true;
    try {
      dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    } catch {}
  }
  const keys = getGroqApiKeys();
  if (!keys || keys.length === 0) {
    const error = new Error('Groq API key is not configured.');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }
  return true;
};

const getModel = ({ temperature = 0, maxTokens = 1500, reasoningEffort = 'low' } = {}) => {
  hasLLM();
  const keys = getOrderedKeys();
  const apiKey = (keys[0] || '').trim();

  return new ChatGroq({
    apiKey,
    model: getModelName(),
    temperature,
    maxTokens,
    reasoningEffort,
    maxRetries: 0,
    timeout: 8000,
  });
};

module.exports = {
  getModel,
  getLLM: getModel,
  hasLLM,
  getModelName,
  DEFAULT_MODEL,
};
