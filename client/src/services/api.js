// API Client Service for iPET Full-Stack Application

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const BASE_URL = API_BASE ? `${API_BASE}/api` : '/api';

function getHeaders() {
  const token = localStorage.getItem('ipet_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const config = {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  };

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return data;
}

export const api = {
  // Auth
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getMe: () => request('/auth/me'),
  updateProfile: (body) => request('/auth/profile', { method: 'PUT', body: JSON.stringify(body) }),

  // Pets (Figure 1 Onboarding & Customization)
  createPet: (body) => request('/pets', { method: 'POST', body: JSON.stringify(body) }),
  getPets: () => request('/pets'),
  getPet: (id) => request(`/pets/${id}`),
  updatePet: (id, body) => request(`/pets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateCustomization: (id, body) => request(`/pets/${id}/customization`, { method: 'PUT', body: JSON.stringify(body) }),

  // Interactive Dialogue Module
  sendMessage: (petId, message, modeOverride) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ petId, message, modeOverride }) }),
  getMessages: (petId) => request(`/chat/${petId}`),

  // Memory Module (3 Categories & Dense Retrieval)
  getMemories: (petId) => request(`/memories/${petId}`),
  createMemory: (petId, content, category) =>
    request('/memories', { method: 'POST', body: JSON.stringify({ petId, content, category }) }),
  processMemories: (petId) => request('/memories/process', { method: 'POST', body: JSON.stringify({ petId }) }),
  deleteMemory: (id) => request(`/memories/${id}`, { method: 'DELETE' }),
  searchMemories: (petId, query, topK) =>
    request('/memories/search', { method: 'POST', body: JSON.stringify({ petId, query, topK }) }),

  // World Simulation Module (T1, T2, T3 & T+1 strategy)
  getTodayWorld: (petId) => request(`/world/${petId}/today`),
  getWorldByDate: (petId, date) => request(`/world/${petId}/date/${date}`),
  generateWorld: (petId, date) => request('/world/generate', { method: 'POST', body: JSON.stringify({ petId, date }) }),
  triggerOfflineTPlusOne: () => request('/world/offline-trigger', { method: 'POST' }),
  getEnvironment: (petId) => request(`/world/${petId}/environment`),

  // Diary
  getDiaryHistory: (petId) => request(`/diary/${petId}`),
  getTodayDiary: (petId) => request(`/diary/${petId}/today`),
  generateDiary: (petId, date, force = true) => request('/diary/generate', { method: 'POST', body: JSON.stringify({ petId, date, force }) }),
  createJournal: (body) => request('/diary', { method: 'POST', body: JSON.stringify(body) }),

  // Emotion Engine
  getEmotion: (petId) => request(`/emotion/${petId}`),
  interactEmotion: (petId, action) =>
    request(`/emotion/${petId}/interact`, { method: 'POST', body: JSON.stringify({ action }) }),

  // Growth Engine
  getGrowth: (petId) => request(`/growth/${petId}`),
  recordActivity: (petId, activityType) =>
    request(`/growth/${petId}/activity`, { method: 'POST', body: JSON.stringify({ activityType }) }),

  // Games
  recordGameResult: (body) =>
    request('/games/record', { method: 'POST', body: JSON.stringify(body) }),
  getGameHistory: (petId) => request(`/games/${petId}/history`),

  // Study Assistant
  recordStudySession: (body) =>
    request('/study/session', { method: 'POST', body: JSON.stringify(body) }),
  executeStudyAction: (body) =>
    request('/study/action', { method: 'POST', body: JSON.stringify(body) }),
  getStudyHistory: (petId) => request(`/study/${petId}/history`),

  // Roadmap Tasks
  getRoadmapTasks: () => request('/roadmap'),
  createRoadmapTask: (body) =>
    request('/roadmap', { method: 'POST', body: JSON.stringify(body) }),
  toggleRoadmapTask: (id) =>
    request(`/roadmap/${id}/toggle`, { method: 'PATCH' }),
  deleteRoadmapTask: (id) =>
    request(`/roadmap/${id}`, { method: 'DELETE' }),

  // Surprises
  getSurprises: (petId) => request(`/surprises/${petId}`),
  triggerSurprise: (petId, force = true) =>
    request('/surprises/trigger', { method: 'POST', body: JSON.stringify({ petId, force }) }),
  markSurpriseViewed: (id) => request(`/surprises/${id}/view`, { method: 'POST' }),

  // Voice
  transcribeAudio: (audio, mimeType) =>
    request('/voice/transcribe', { method: 'POST', body: JSON.stringify({ audio, mimeType }) }),
  speakText: (text, personality) =>
    request('/voice/speak', { method: 'POST', body: JSON.stringify({ text, personality }) }),

  // Evaluation & Stats
  runEvaluation: (petId, method) =>
    request('/evaluation/run', { method: 'POST', body: JSON.stringify({ petId, method }) }),
  getStats: (petId) => request(`/evaluation/stats/${petId}`),
  trainSFT: (epochs = 3) =>
    request('/evaluation/train-sft', { method: 'POST', body: JSON.stringify({ epochs }) })
};
