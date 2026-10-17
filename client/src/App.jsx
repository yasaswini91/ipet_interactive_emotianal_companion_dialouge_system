import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import HomeDashboard from './components/HomeDashboard';
import ChatWindow from './components/ChatWindow';
import DailyWorld from './components/DailyWorld';
import MemoryPanel from './components/MemoryPanel';
import PetEmotionAndGrowth from './components/PetEmotionAndGrowth';
import MiniGames from './components/MiniGames';
import StudyAssistant from './components/StudyAssistant';
import DiaryPanel from './components/DiaryPanel';
import RoadmapTasks from './components/RoadmapTasks';
import EvaluationAndStats from './components/EvaluationAndStats';
import SettingsPanel from './components/SettingsPanel';
import AuthModal from './components/AuthModal';
import Onboarding from './components/Onboarding';
import SurpriseCard from './components/SurpriseCard';
import CuteBackground from './components/CuteBackground';
import { api } from './services/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('ipet_token') || '');
  const [pets, setPets] = useState([]);
  const [currentPet, setCurrentPet] = useState(null);
  const [currentTab, setCurrentTab] = useState('home');

  // Core Data States
  const [todayWorld, setTodayWorld] = useState(null);
  const [messages, setMessages] = useState([]);
  const [memories, setMemories] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [emotion, setEmotion] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [activeSurprise, setActiveSurprise] = useState(null);
  const [stats, setStats] = useState(null);

  // Loading States
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isTPlusOneRunning, setIsTPlusOneRunning] = useState(false);
  const [isProcessingMemories, setIsProcessingMemories] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState('');

  // 1. Initial Load: Check token & user
  useEffect(() => {
    if (token) {
      api.getMe()
        .then(res => {
          setUser(res.user);
          loadUserPets();
        })
        .catch(() => {
          handleLogout();
        });
    }
  }, [token]);

  // Load User Pets
  const loadUserPets = async () => {
    try {
      const res = await api.getPets();
      setPets(res.pets || []);
      if (res.pets && res.pets.length > 0) {
        setCurrentPet(res.pets[0]);
      }
    } catch (err) {
      console.error('Error fetching pets:', err);
    }
  };

  // 2. Load Pet Subsystems whenever currentPet changes
  useEffect(() => {
    if (currentPet?._id) {
      loadPetData(currentPet._id);
    }
  }, [currentPet?._id]);

  const loadPetData = async (petId) => {
    try {
      const worldRes = await api.getTodayWorld(petId);
      setTodayWorld(worldRes.world);

      const chatRes = await api.getMessages(petId);
      setMessages(chatRes.messages || []);

      const memRes = await api.getMemories(petId);
      setMemories(memRes.memories || []);

      const diaryRes = await api.getDiaryHistory(petId);
      setDiaries(diaryRes.entries || []);

      const petDetails = await api.getPet(petId);
      setEmotion(petDetails.emotion);
      setGrowth(petDetails.growth);

      const surpriseRes = await api.getSurprises(petId);
      const unviewed = (surpriseRes.surprises || []).find(s => !s.viewed);
      setActiveSurprise(unviewed || null);

      const statRes = await api.getStats(petId);
      setStats(statRes);
    } catch (err) {
      console.error('Error loading pet data:', err);
    }
  };

  // Auth Handlers
  const handleLogin = async ({ email, password }) => {
    setIsAuthLoading(true);
    try {
      const res = await api.login({ email, password });
      localStorage.setItem('ipet_token', res.token);
      setToken(res.token);
      setUser(res.user);
      await loadUserPets();
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleRegister = async ({ username, email, password, name }) => {
    setIsAuthLoading(true);
    try {
      const res = await api.register({ username, email, password, name });
      localStorage.setItem('ipet_token', res.token);
      setToken(res.token);
      setUser(res.user);
      await loadUserPets();
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('ipet_token');
    setToken('');
    setUser(null);
    setCurrentPet(null);
    setPets([]);
  };

  // Onboarding Pet Creation
  const handleCreatePet = async (petData) => {
    setIsAuthLoading(true);
    try {
      const res = await api.createPet(petData);
      setPets([res.pet]);
      setCurrentPet(res.pet);
      setTodayWorld(res.world);
      setEmotion(res.emotion);
      setGrowth(res.growth);
      setCurrentTab('home');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Chat Handler
  const handleSendMessage = async (text, modeOverride) => {
    if (!currentPet) return;
    setIsChatLoading(true);
    try {
      const result = await api.sendMessage(currentPet._id, text, modeOverride);
      setMessages(prev => [...prev, result.userMessage, result.petResponse]);
      if (result.emotion) setEmotion(result.emotion);
      if (result.growth) setGrowth(result.growth);

      if (result.extractedMemories && result.extractedMemories.length > 0) {
        setMemories(prev => {
          const ids = new Set(prev.map(m => m._id));
          const fresh = result.extractedMemories.filter(m => !ids.has(m._id));
          return [...fresh, ...prev];
        });
      }

      api.getMemories(currentPet._id).then(r => setMemories(r.memories || []));
      api.getStats(currentPet._id).then(r => setStats(r));

      return result;
    } catch (err) {
      console.error('Chat error:', err);
      const userMsg = {
        _id: 'temp-' + Date.now(),
        sender: 'user',
        content: text,
        createdAt: new Date().toISOString()
      };
      const petErrorMsg = {
        _id: 'err-' + Date.now(),
        sender: 'pet',
        content: `*whimpers softly* I had trouble reaching my server (${err.message || 'connection error'}). Please verify the backend is running!`,
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMsg, petErrorMsg]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Discuss Schedule in Chat
  const handleDiscussSchedule = (activity) => {
    setChatInitialPrompt(`Tell me more about when you ${activity.toLowerCase()}!`);
    setCurrentTab('chat');
  };

  // Trigger T+1 Offline Sim
  const handleTriggerTPlusOne = async () => {
    setIsTPlusOneRunning(true);
    try {
      await api.triggerOfflineTPlusOne();
      if (currentPet?._id) {
        await loadPetData(currentPet._id);
      }
    } finally {
      setIsTPlusOneRunning(false);
    }
  };

  // Memory extraction
  const handleProcessMemories = async () => {
    if (!currentPet) return;
    setIsProcessingMemories(true);
    try {
      await api.processMemories(currentPet._id);
      const res = await api.getMemories(currentPet._id);
      setMemories(res.memories || []);
    } finally {
      setIsProcessingMemories(false);
    }
  };

  // Memory Add
  const handleAddMemory = async (content, category) => {
    if (!currentPet) return;
    const res = await api.createMemory(currentPet._id, content, category);
    if (res?.memory) {
      setMemories(prev => [res.memory, ...prev]);
    }
  };

  // Memory delete
  const handleDeleteMemory = async (id) => {
    await api.deleteMemory(id);
    setMemories(prev => prev.filter(m => m._id !== id));
  };

  // Dense search tester
  const handleSearchMemories = async (query) => {
    if (!currentPet) return { results: [] };
    return api.searchMemories(currentPet._id, query, 5);
  };

  // Emotion Interaction
  const handleEmotionInteract = async (action) => {
    if (!currentPet) return;
    try {
      const res = await api.interactEmotion(currentPet._id, action);
      if (res?.emotion) setEmotion(res.emotion);
      if (res?.growth) setGrowth(res.growth);
      return res;
    } catch (err) {
      console.error('Interact error:', err);
      // Optimistic update so user is never blocked
      setEmotion(prev => ({
        ...prev,
        happiness: Math.min(100, (prev?.happiness || 85) + 5),
        affection: Math.min(100, (prev?.affection || 80) + 5)
      }));
      return { success: true };
    }
  };

  // Award XP from game/study
  const handleAwardXP = async () => {
    if (!currentPet) return;
    try {
      const res = await api.interactEmotion(currentPet._id, 'play');
      if (res?.emotion) setEmotion(res.emotion);
      if (res?.growth) setGrowth(res.growth);
      return res;
    } catch {
      setGrowth(prev => ({
        ...prev,
        xp: (prev?.xp || 0) + 15
      }));
      return { success: true };
    }
  };

  // Write Master Diary note
  const handleWriteUserDiary = async (entry) => {
    if (!currentPet) return;
    const res = await api.createJournal({
      petId: currentPet._id,
      ...entry
    });
    setDiaries(prev => [res.entry, ...prev]);
  };

  // Generate Pet Companion Diary with Qwen
  const [isGeneratingDiary, setIsGeneratingDiary] = useState(false);
  const [diaryError, setDiaryError] = useState(null);

  const handleGenerateDiary = async () => {
    if (!currentPet) return;
    setIsGeneratingDiary(true);
    setDiaryError(null);
    try {
      const res = await api.generateDiary(currentPet._id, null, true);
      if (res?.entry) {
        setDiaries(prev => {
          const filtered = prev.filter(d => d.date !== res.entry.date);
          return [res.entry, ...filtered];
        });
      }
    } catch (err) {
      console.error('Failed to generate diary:', err);
      setDiaryError(err.message || 'Failed to generate diary');
    } finally {
      setIsGeneratingDiary(false);
    }
  };

  // Acknowledge Surprise
  const handleAcknowledgeSurprise = async (id) => {
    await api.markSurpriseViewed(id);
    setActiveSurprise(null);
  };

  // Evaluation Runner
  const handleRunEvaluation = async (method) => {
    if (!currentPet) return;
    return api.runEvaluation(currentPet._id, method);
  };

  // Render Login if unauthenticated
  if (!user || !token) {
    return (
      <AuthModal
        onLogin={handleLogin}
        onRegister={handleRegister}
        isLoading={isAuthLoading}
      />
    );
  }

  // Render Onboarding if user has no pet
  if (pets.length === 0 || !currentPet) {
    return (
      <Onboarding
        onComplete={handleCreatePet}
        isCreating={isAuthLoading}
      />
    );
  }

  return (
    <div className="min-h-screen relative flex selection:bg-pink-100 selection:text-pink-600">
      {/* Whimsical Cute Floating Ambient Background */}
      <CuteBackground />

      {/* Desktop Left Sidebar */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        pet={currentPet}
        emotion={emotion}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <TopNav
          user={user}
          pet={currentPet}
          weather={todayWorld?.weather}
          currentTab={currentTab}
          onLogout={handleLogout}
        />

        <main className="flex-1 p-8 overflow-y-auto">
          {/* Active Memory-Based Surprise Banner */}
          {activeSurprise && (
            <SurpriseCard
              surprise={{ ...activeSurprise, petName: currentPet.name }}
              onAcknowledge={handleAcknowledgeSurprise}
            />
          )}

          {/* Tab Views */}
          {currentTab === 'home' && (
            <HomeDashboard
              pet={currentPet}
              user={user}
              weather={todayWorld?.weather}
              emotion={emotion}
              onNavigateTab={setCurrentTab}
              onInteract={handleEmotionInteract}
            />
          )}

          {currentTab === 'chat' && (
            <ChatWindow
              pet={currentPet}
              user={user}
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isChatLoading}
              initialInput={chatInitialPrompt}
              memories={memories}
              onNavigateTab={setCurrentTab}
            />
          )}

          {currentTab === 'pet' && (
            <PetEmotionAndGrowth
              pet={currentPet}
              emotion={emotion}
              growth={growth}
              onInteract={handleEmotionInteract}
            />
          )}

          {currentTab === 'world' && (
            <DailyWorld
              world={todayWorld}
              pet={currentPet}
              onDiscussInChat={handleDiscussSchedule}
              onTriggerTPlusOne={handleTriggerTPlusOne}
              isTPlusOneRunning={isTPlusOneRunning}
            />
          )}

          {currentTab === 'games' && (
            <MiniGames
              pet={currentPet}
              emotion={emotion}
              growth={growth}
              onAwardXP={handleAwardXP}
            />
          )}

          {currentTab === 'study' && (
            <StudyAssistant
              pet={currentPet}
              user={user}
              onAwardXP={handleAwardXP}
            />
          )}

          {currentTab === 'journal' && (
            <DiaryPanel
              pet={currentPet}
              diaries={diaries}
              onGenerateDiary={handleGenerateDiary}
              isGenerating={isGeneratingDiary}
              generationError={diaryError}
              onWriteUserDiary={handleWriteUserDiary}
            />
          )}

          {currentTab === 'roadmap' && (
            <RoadmapTasks
              pet={currentPet}
              user={user}
            />
          )}

          {currentTab === 'memories' && (
            <MemoryPanel
              pet={currentPet}
              memories={memories}
              onProcessMemories={handleProcessMemories}
              onDeleteMemory={handleDeleteMemory}
              onSearchMemories={handleSearchMemories}
              onAddMemory={handleAddMemory}
              isProcessing={isProcessingMemories}
            />
          )}

          {currentTab === 'evaluation' && (
            <EvaluationAndStats
              pet={currentPet}
              onRunEvaluation={handleRunEvaluation}
              stats={stats}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsPanel user={user} />
          )}
        </main>
      </div>
    </div>
  );
}
