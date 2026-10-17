import { companionConfig, getActiveQwenModelName, getPublicModelStatus } from '../config/companionConfig.js';
import { logEvent, logError } from '../utils/logger.js';

export class QwenUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QwenUnavailableError';
    this.status = 503;
    this.code = 'QWEN_UNAVAILABLE';
    this.details = details;
  }
}

let runtimeOverrides = {};

function cfg() {
  return {
    ...companionConfig.llm,
    ...runtimeOverrides
  };
}

function parseJsonLoose(text) {
  if (!text) throw new Error('Empty Qwen JSON response');
  let clean = text.trim();
  // Strip markdown code fences
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Try direct parse
  try {
    return JSON.parse(clean);
  } catch {}

  // 2. Locate JSON boundaries
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');
  let startIdx = -1;
  let isObj = true;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    isObj = true;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    isObj = false;
  }

  if (startIdx !== -1) {
    let candidate = clean.slice(startIdx);
    const endIdx = isObj ? candidate.lastIndexOf('}') : candidate.lastIndexOf(']');
    if (endIdx !== -1) {
      candidate = candidate.slice(0, endIdx + 1);
    } else {
      candidate = candidate.replace(/,\s*$/, '') + (isObj ? '}' : ']');
    }

    // Remove trailing commas before closing braces/brackets
    candidate = candidate.replace(/,\s*([\]}])/g, '$1');

    try {
      return JSON.parse(candidate);
    } catch {}

    // Handle truncated inner objects/arrays
    try {
      let trimmed = candidate.replace(/,\s*\{[^}]*$/, ''); // drop trailing cut-off object
      if (trimmed.includes('[') && !trimmed.includes(']')) trimmed += ']';
      if (trimmed.includes('{') && !trimmed.endsWith('}')) trimmed += '}';
      trimmed = trimmed.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(trimmed);
    } catch {}
  }

  throw new Error(`Qwen did not return valid JSON: ${text.slice(0, 160)}`);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isQwenModelName(name = '') {
  const n = String(name).toLowerCase();
  return n.includes('qwen');
}

async function callOpenAICompatible({ endpoint, apiKey, model, systemPrompt, userPrompt, messages, temperature, jsonMode, maxTokens, timeoutMs }) {
  const url = endpoint.includes('/chat/completions')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/chat/completions`;

  const chatMessages = (messages && Array.isArray(messages) && messages.length > 0)
    ? messages
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

  const body = {
    model,
    messages: chatMessages,
    temperature,
    max_tokens: maxTokens || cfg().maxNewTokens
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, timeoutMs);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible Qwen HTTP ${res.status}: ${errText.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Qwen returned empty content');
  return text.trim();
}

async function callHuggingFaceQwen({ endpoint, apiKey, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs }) {
  const chatML = `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${userPrompt}<|im_end|>\n<|im_start|>assistant\n`;
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      inputs: chatML,
      parameters: {
        max_new_tokens: maxTokens || cfg().maxNewTokens,
        temperature,
        return_full_text: false
      }
    })
  }, timeoutMs);
  if (!res.ok) throw new Error(`Hugging Face Qwen HTTP ${res.status}`);
  const data = await res.json();
  const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
  if (!text) throw new Error('Hugging Face Qwen returned empty content');
  return String(text).replace(/<\|im_end\|>/g, '').trim();
}

async function callOllamaQwen({ endpoint, model, systemPrompt, userPrompt, messages, temperature, maxTokens, timeoutMs, task }) {
  const url = `${endpoint.replace(/\/$/, '')}/api/chat`;
  const chatMessages = (messages && Array.isArray(messages) && messages.length > 0)
    ? messages
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      stream: false,
      options: {
        temperature,
        num_ctx: cfg().contextLength,
        num_predict: maxTokens || cfg().maxNewTokens,
        task: task || 'dialogue'
      }
    })
  }, timeoutMs);
  if (!res.ok) throw new Error(`Ollama Qwen HTTP ${res.status}`);
  const data = await res.json();
  const text = data.message?.content;
  if (!text) throw new Error('Ollama Qwen returned empty content');
  return text.trim();
}

/**
 * Production chatbot brain: Qwen only.
 * Never falls back to GPT, Gemini, or a rule-based persona engine.
 */
export const qwenService = {
  getStatus() {
    const c = cfg();
    return {
      ...getPublicModelStatus(),
      activeModel: getActiveQwenModelName(),
      ollamaModel: c.ollamaModel,
      hasApiKey: !!c.apiKey
    };
  },

  updateConfig(partial = {}) {
    const allowed = ['temperature', 'endpoint', 'ollamaModel', 'apiKey', 'timeoutMs'];
    for (const key of allowed) {
      if (partial[key] !== undefined) runtimeOverrides[key] = partial[key];
    }
    if (partial.model && isQwenModelName(partial.model)) {
      runtimeOverrides.ollamaModel = partial.model;
    }
    if (partial.model && !isQwenModelName(partial.model) && partial.model !== undefined) {
      throw new Error('Only Qwen models may be selected for chat');
    }
    logEvent('qwen.config_updated', { keys: Object.keys(partial) });
    return this.getStatus();
  },

  async generateRaw({ systemPrompt, userPrompt, messages, temperature, jsonMode = false, task = 'dialogue', maxTokens = null }) {
    const c = cfg();
    const temp = temperature ?? c.temperature;
    const modelName = getActiveQwenModelName();
    const errors = [];

    // Task-specific default max tokens to prevent CPU stalling
    const defaultTokensByTask = {
      dialogue: 40,
      user_emotion: 35,
      memory_extraction: 80,
      memory_classification: 40,
      memory_conflict: 60,
      world_t1: 150,
      world_t2: 200,
      world_t3: 150,
      diary: 60,
      surprise: 100,
      json: 120
    };
    const effectiveMaxTokens = maxTokens || defaultTokensByTask[task] || c.maxNewTokens;

    logEvent('qwen.request', {
      task,
      modelStatus: companionConfig.llm.modelStatus,
      jsonMode,
      temperature: temp,
      maxTokens: effectiveMaxTokens
    });

    const endpoint = c.endpoint || c.ollamaEndpoint;
    const looksLocalOllama = /11434/.test(endpoint) || /ollama/i.test(endpoint);
    const looksHF = /huggingface\.co/.test(endpoint);
    const looksOpenAICompat = /\/v1|dashscope|vllm|localhost:(8000|8001|8080)/i.test(endpoint);

    try {
      if (looksHF && c.apiKey) {
        const text = await callHuggingFaceQwen({
          endpoint,
          apiKey: c.apiKey,
          systemPrompt,
          userPrompt,
          temperature: temp,
          maxTokens: effectiveMaxTokens,
          timeoutMs: c.timeoutMs
        });
        logEvent('qwen.success', { task, backend: 'huggingface' });
        return { text, source: 'REAL_LLM', backend: 'huggingface', model: modelName, modelStatus: companionConfig.llm.modelStatus };
      }

      if (!looksLocalOllama && (c.apiKey || looksOpenAICompat)) {
        let targetModel = c.baseModel || companionConfig.llm.baseModel || 'qwen-2.5-32b';
        if (endpoint.includes('groq.com')) {
          targetModel = (c.baseModel && c.baseModel.includes('qwen')) ? c.baseModel : 'qwen-2.5-32b';
        } else if (endpoint.includes('together')) {
          targetModel = (c.baseModel && c.baseModel.includes('Qwen')) ? c.baseModel : 'Qwen/Qwen2.5-7B-Instruct';
        } else if (endpoint.includes('openrouter')) {
          targetModel = (c.baseModel && c.baseModel.includes('qwen')) ? c.baseModel : 'qwen/qwen-2.5-7b-instruct';
        }

        const text = await callOpenAICompatible({
          endpoint,
          apiKey: c.apiKey,
          model: c.useFinetuned ? modelName : targetModel,
          systemPrompt,
          userPrompt,
          messages,
          temperature: temp,
          jsonMode,
          maxTokens: effectiveMaxTokens,
          timeoutMs: c.timeoutMs
        });
        logEvent('qwen.success', { task, backend: 'openai_compatible', model: targetModel });
        return { text, source: 'REAL_LLM', backend: 'openai_compatible', model: targetModel, modelStatus: companionConfig.llm.modelStatus };
      }
    } catch (err) {
      errors.push(err.message);
      logError('qwen.endpoint_failed', err, { task, backend: 'http' });
    }

    try {
      const ollamaModel = c.useFinetuned
        ? (process.env.QWEN_OLLAMA_FINETUNED_MODEL || c.ollamaModel)
        : c.ollamaModel;
      const text = await callOllamaQwen({
        endpoint: c.ollamaEndpoint,
        model: ollamaModel,
        systemPrompt,
        userPrompt,
        messages,
        temperature: temp,
        maxTokens: effectiveMaxTokens,
        timeoutMs: c.timeoutMs,
        task
      });
      logEvent('qwen.success', { task, backend: 'ollama', modelStatus: companionConfig.llm.modelStatus });
      return { text, source: 'REAL_LLM', backend: 'ollama', model: ollamaModel, modelStatus: companionConfig.llm.modelStatus };
    } catch (err) {
      errors.push(err.message);
      logError('qwen.ollama_failed', err, { task });
    }

    throw new QwenUnavailableError(
      'Qwen model is unavailable. No rule-based fallback is used. Start a local Qwen runtime (Ollama/vLLM) or configure QWEN_ENDPOINT.',
      { attempts: errors, modelStatus: companionConfig.llm.modelStatus }
    );
  },

  async generateDialogue(contextPrompt) {
    const result = await this.generateRaw({
      systemPrompt: contextPrompt.systemPrompt,
      userPrompt: contextPrompt.userPrompt,
      messages: contextPrompt.messages,
      temperature: contextPrompt.temperature ?? cfg().temperature,
      jsonMode: false,
      task: 'dialogue',
      maxTokens: contextPrompt.maxTokens || 40
    });
    return result;
  },

  async generateStructuredJSON({ systemPrompt, userPrompt, temperature = 0.2, task = 'json', maxTokens = null }) {
    const result = await this.generateRaw({
      systemPrompt: `${systemPrompt}\n\nReturn ONLY valid JSON. No markdown.`,
      userPrompt,
      temperature,
      jsonMode: true,
      task,
      maxTokens
    });
    const parsed = parseJsonLoose(result.text);
    return { ...result, parsed };
  },

  async generateMemoryExtraction(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'memory_extraction', temperature: 0.2, maxTokens: prompt.maxTokens || 120 });
  },

  async generateMemoryClassification(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'memory_classification', temperature: 0.1, maxTokens: prompt.maxTokens || 50 });
  },

  async resolveMemoryConflict(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'memory_conflict', temperature: 0.2, maxTokens: prompt.maxTokens || 80 });
  },

  async generateWorldOutline(prompt) {
    return this.generateRaw({ ...prompt, task: 'world_t1', temperature: 0.9, maxTokens: prompt.maxTokens || 180 });
  },

  async generateWorldSchedule(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'world_t2', temperature: 0.7, maxTokens: prompt.maxTokens || 250 });
  },

  async generateWorldDetail(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'world_t3', temperature: 0.85, maxTokens: prompt.maxTokens || 180 });
  },

  async generateDiary(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'diary', temperature: 0.7, maxTokens: prompt.maxTokens || 250 });
  },

  async generateSurprise(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'surprise', temperature: 0.7, maxTokens: prompt.maxTokens || 120 });
  },

  async generateUserEmotion(prompt) {
    return this.generateStructuredJSON({ ...prompt, task: 'user_emotion', temperature: 0.1, maxTokens: prompt.maxTokens || 40 });
  }
};

// Backward-compatible surface used by older imports. Chat MUST still go through Qwen.
export const llmService = {
  getConfig() {
    return qwenService.getStatus();
  },
  updateConfig(newConfig) {
    return qwenService.updateConfig(newConfig);
  },
  async callLLM({ systemPrompt, userPrompt, messages, temperature, jsonMode, maxTokens }) {
    const result = await qwenService.generateRaw({ systemPrompt, userPrompt, messages, temperature, jsonMode, task: jsonMode ? 'json' : 'dialogue', maxTokens });
    return result.text;
  }
};
