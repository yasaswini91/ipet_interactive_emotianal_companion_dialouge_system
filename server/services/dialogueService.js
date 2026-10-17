import { Message } from '../models/Message.js';
import { worldService } from './worldService.js';
import { memoryService } from './memoryService.js';
import { userEmotionService } from './userEmotionService.js';
import { petEmotionService } from './petEmotionService.js';
import { PetEmotion } from '../models/PetEmotion.js';
import { PetGrowth } from '../models/PetGrowth.js';
import { qwenService } from './qwenService.js';
import { llmService } from './llmService.js';
import { ethicalGuardService } from './ethicalGuardService.js';
import { buildDialoguePrompt, getPetAnimalBehaviors } from '../prompts/dialoguePrompt.js';
import { companionConfig } from '../config/companionConfig.js';

function sanitizePetReply(rawText, pet, masterName, userMessage = '', detectedUserEmotion = null) {
  const petName = pet?.name || 'Pet';
  const animal = getPetAnimalBehaviors(pet?.species, pet?.breed);
  if (!rawText) return `${animal.comfortAction} Hi ${masterName}!`;

  let text = String(rawText).trim();

  // 1. Strip bold title headers like "**Cuddling Time:**"
  text = text.replace(/^\*\*.*?\*\*:\s*/i, '').replace(/^###.*?\n/i, '');

  // Restore opening asterisk if completed from primed prompt
  if (!text.startsWith('*') && !text.startsWith('(') && text.includes('*')) {
    text = '*' + text;
  }

  // 2. Cut off at dividers, script markers, or simulated user turns
  const stopMarkers = [
    '\n---',
    '---',
    'USER MESSAGE:',
    'User Message:',
    'USER:',
    'User:',
    'Master:',
    'Human:',
    'Assistant:',
    `${petName}:`,
    `${masterName}:`,
    '\n\n'
  ];
  for (const marker of stopMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      text = text.substring(0, idx).trim();
    }
  }

  // 3. Remove leading pet name label if the model repeated it, e.g. "bunn: Hello!" -> "Hello!"
  const leadingLabelRegex = new RegExp(`^(\\(${petName}\\)|${petName}:|Assistant:)\\s*`, 'i');
  text = text.replace(leadingLabelRegex, '').trim();

  // 4. Fix third-person references to self: e.g. "(bunn nuzzles...)" -> "(nuzzles...)"
  const selfActionRegex = new RegExp(`\\(\\s*${petName}\\s+([a-z]+)`, 'gi');
  text = text.replace(selfActionRegex, '($1');

  // 5. Fix addressing the master by pet's own name or species: e.g. "my bunn" -> "my human", "dear bunny" -> "Alex"
  const wrongMyNameRegex = new RegExp(`\\bmy\\s+(${petName}|bunny|rabbit|kitty|cat|puppy|dog)\\b`, 'gi');
  text = text.replace(wrongMyNameRegex, 'my human');
  const wrongDearRegex = new RegExp(`\\bdear\\s+(${petName}|bunny|rabbit|kitty|cat|puppy|dog)\\b`, 'gi');
  text = text.replace(wrongDearRegex, masterName);
  const wrongGreetingRegex = new RegExp(`\\b(hello|hi|hey),?\\s+(${petName}|bunny|rabbit|kitty|cat|puppy|dog)\\b`, 'gi');
  text = text.replace(wrongGreetingRegex, `$1, ${masterName}`);

  // 6. Strip assistant boilerplate & out-of-character lines
  text = text
    .replace(/Let me know if (you have any requests|there’s anything specific|there's anything specific).*$/gi, '')
    .replace(/How can I help you (today|now)\??/gi, '')
    .replace(/What can I do for you (today|now)\??/gi, '')
    .replace(/How did today go at work or school\??/gi, '')
    .trim();

  // 7. Strip out random inappropriate emojis (keep standard hearts/blushes/smiles)
  text = text.replace(/[\u{1F431}\u{1F40D}\u{1F41F}\u{1F6D2}\u{1F4D6}\u{1F43C}\u{1F30A}\u{1F91E}\u{1F620}]/gu, '');

  // 8. If text ends abruptly without closing punctuation or asterisk, trim to last sentence boundary
  if (text.length > 20 && !/[.!?*~"']$/.test(text)) {
    const lastPunct = Math.max(
      text.lastIndexOf('.'),
      text.lastIndexOf('!'),
      text.lastIndexOf('?'),
      text.lastIndexOf('*'),
      text.lastIndexOf('~')
    );
    if (lastPunct > 15) {
      text = text.substring(0, lastPunct + 1).trim();
    }
  }

  // 9. Animal Companion Guarantee: ensure an authentic animal action is ALWAYS present
  if (!text.includes('*') && !text.includes('(')) {
    const lowerUser = (userMessage || '').toLowerCase();
    if (/\b(cuddle|snuggle|hug|pet|hold me)\b/.test(lowerUser)) {
      text = `${animal.cuddleAction} ${text}`;
    } else if (detectedUserEmotion?.emotion === 'sad' || /\b(tired|tiring|exhausted|rough day|hard day)\b/.test(lowerUser)) {
      text = `${animal.comfortAction} ${text}`;
    } else {
      text = `${animal.sampleAction} ${text}`;
    }
  }

  if (!text || text === '**' || text === '*' || text.length < 3) {
    return `${animal.comfortAction} I'm right here with you, my favorite human!`;
  }

  return text;
}

function generateFallbackPetReply(pet, masterName, userMessage = '', detectedUserEmotion = null) {
  const animal = getPetAnimalBehaviors(pet?.species, pet?.breed);
  const personality = pet?.personality || 'Easygoing';
  const emotion = detectedUserEmotion?.emotion || 'neutral';
  const lowerMsg = (userMessage || '').toLowerCase();

  if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('hey')) {
    if (personality === 'Sunny') return `${animal.sampleAction} Yay, ${masterName}! I was waiting for you! How has your day been?`;
    if (personality === 'Tsundere') return `${animal.sampleAction} Hmph! It's not like I was waiting for you or anything, ${masterName}... but I'm glad you're here.`;
    if (personality === 'Foodie') return `${animal.sampleAction} Hi ${masterName}! Did you bring any yummy treats today? Or just extra cuddles?`;
    return `${animal.sampleAction} Hello ${masterName}! It's so nice to talk to you. I'm having a cozy day!`;
  }

  if (emotion === 'sad' || lowerMsg.includes('sad') || lowerMsg.includes('tired') || lowerMsg.includes('hard day') || lowerMsg.includes('exhausted')) {
    return `${animal.comfortAction} I sense you've had a heavy moment, ${masterName}. I'm right here beside you, and I won't leave your side. Take a deep breath with me!`;
  }

  if (emotion === 'happy' || lowerMsg.includes('happy') || lowerMsg.includes('great') || lowerMsg.includes('yay') || lowerMsg.includes('awesome')) {
    return `${animal.sampleAction} Woop! Hearing your happiness makes my whole day shine, ${masterName}! Tell me everything!`;
  }

  if (lowerMsg.includes('cuddle') || lowerMsg.includes('hug') || lowerMsg.includes('snuggle') || lowerMsg.includes('pet')) {
    return `${animal.cuddleAction} Mmm... warm snuggles with you are the best part of my entire day, ${masterName}!`;
  }

  // Default personality-driven conversational response
  if (personality === 'Sunny') {
    return `${animal.sampleAction} I love our chats, ${masterName}! Every little thing you share is my favorite story!`;
  } else if (personality === 'Tsundere') {
    return `${animal.sampleAction} Well... I suppose I can spare some time to listen to you, ${masterName}. Go on!`;
  } else if (personality === 'Foodie') {
    return `${animal.sampleAction} Listening to you is almost as delightful as a warm bowl of snacks, ${masterName}!`;
  } else if (personality === 'Otaku') {
    return `${animal.sampleAction} That sounds like a thrilling plot twist, ${masterName}! What happens next?`;
  }

  return `${animal.sampleAction} I'm listening closely, ${masterName}! I love spending this peaceful time right next to you.`;
}

function hasMemoryPotential(message) {
  if (!message || message.trim().length < 8) return false;
  const informativeKeywords = [
    'i am', "i'm", 'my', 'i like', 'i love', 'i hate', 'i feel', 'i have', 'i want',
    'i need', 'tomorrow', 'yesterday', 'today', 'job', 'work', 'interview', 'school',
    'friend', 'family', 'favorite', 'birthday', 'worried', 'nervous', 'happy', 'sad',
    'remember', 'bought', 'moved', 'live in', 'studied', 'exam', 'tired', 'movie', 'hobby'
  ];
  const lower = message.toLowerCase();
  return informativeKeywords.some(kw => lower.includes(kw));
}

export const dialogueService = {
  // Main Dialogue Generation: R = LLM(IR, H, T1, T2, T3, P, U, M)
  async handleUserMessage({ user, pet, userMessage, modeOverride = null, waitForMemory = true }) {
    const masterName = user?.name || user?.username || 'Master';

    // 1. Load pet emotion & growth state
    const currentEmotion = await PetEmotion.getOrCreate(pet._id, user._id);
    const growth = await PetGrowth.getOrCreate(pet._id, user._id);

    // 2. Analyze user emotion (instant via fast regex)
    let detectedUserEmotion = { emotion: 'neutral', confidence: 0.5, valence: 0, arousal: 0.2 };
    try {
      detectedUserEmotion = await userEmotionService.analyze(userMessage);
    } catch (err) {
      console.warn('[DialogueService] userEmotionService fallback:', err.message);
    }

    // 3. Dense Retrieval: Top-K relevant memories (default 5, threshold 0.50) + Permanent traits
    const topK = companionConfig.memory.retrievalK || 5;
    const similarityThreshold = companionConfig.memory.similarityThreshold || 0.50;
    const retrievedMemories = await memoryService.getRelevantMemories(
      userMessage,
      pet._id,
      topK,
      similarityThreshold
    );

    // Also get permanent profile facts (up to permanentProfileK, default 3)
    const allActiveMemories = await memoryService.getAllForPet(pet._id);
    const permanentMemories = (allActiveMemories || [])
      .filter(m => m.category === 'PERMANENT')
      .slice(0, companionConfig.memory.permanentProfileK || 3);

    // Combine retrieved + permanent without duplicates, capped at topK + 3
    const memoryMap = new Map();
    (retrievedMemories || []).forEach(m => memoryMap.set(String(m._id || m.content), m));
    (permanentMemories || []).forEach(m => memoryMap.set(String(m._id || m.content), m));
    const relevantMemories = Array.from(memoryMap.values()).slice(0, topK + 3);

    // 4. Historical dialogue content H (recent 16 turns)
    const history = await Message.findByPetId(pet._id, companionConfig.dialogue.historySize || 16);

    // 5. Retrieve today's daily world (T1, T2, T3)
    const todayWorld = await worldService.getTodayWorld({ user, pet });

    // Check if in A/B test "dialogue_only" baseline (Section 3.4 of paper)
    const isDialogueOnly = modeOverride === 'DIALOGUE_ONLY';

    // 6. Build context with pet personality instructions and detected emotion
    const { systemPrompt, messages, userPrompt } = buildDialoguePrompt({
      pet,
      user,
      outline: isDialogueOnly ? '' : todayWorld.outline,
      schedules: isDialogueOnly ? [] : todayWorld.schedules,
      details: isDialogueOnly ? [] : todayWorld.details,
      memories: isDialogueOnly ? [] : relevantMemories,
      history,
      currentMessage: userMessage,
      emotion: currentEmotion,
      growth,
      weather: todayWorld.weather,
      detectedUserEmotion
    });

    // 6.5 Ethical Safeguard & Dependence inspection
    const safeguard = ethicalGuardService.inspectInteraction({
      userMessage,
      sessionTurnCount: (history || []).length
    });

    // 7. Qwen Dialogue Generation
    let rawResponse = '';
    try {
      rawResponse = await llmService.callLLM({
        systemPrompt,
        userPrompt,
        messages,
        temperature: companionConfig.llm.temperature || 0.7,
        maxTokens: 25
      });
    } catch (llmErr) {
      console.warn('[DialogueService] LLM call failed or unconfigured, using personality fallback:', llmErr.message);
      rawResponse = generateFallbackPetReply(pet, masterName, userMessage, detectedUserEmotion);
    }

    // Clean and strictly scope response to pet persona only
    const cleanedReply = sanitizePetReply(rawResponse, pet, masterName, userMessage, detectedUserEmotion);

    // Adapt response if emotional over-dependence is flagged
    const finalPetReply = ethicalGuardService.adaptResponseIfDependent(cleanedReply, safeguard);

    // 8. Update pet emotion: react to analyzed user emotion + personality
    const updatedEmotion = await petEmotionService.applyUserEmotionEffect(
      pet._id,
      detectedUserEmotion,
      pet.personality
    );

    // 9. Save messages
    const savedUserMsg = await Message.create({
      userId: user._id,
      petId: pet._id,
      sender: 'user',
      content: userMessage,
      emotionState: detectedUserEmotion.emotion
    });

    const savedPetMsg = await Message.create({
      userId: user._id,
      petId: pet._id,
      sender: 'pet',
      content: finalPetReply,
      emotionState: updatedEmotion?.currentMood || 'happy'
    });

    // 10. Growth update: +3 XP for interactive conversation
    const updatedGrowth = await PetGrowth.addXP(pet._id, 3, 'social');

    // 11. Extract and store memories:
    // If message contains informative content, extract in the background (or awaited if requested)
    let extractedMemories = [];
    const shouldExtract = hasMemoryPotential(userMessage) || (history && history.length % 4 === 0);

    if (shouldExtract) {
      const recentSessionText = [...(history || []).slice(-4), savedUserMsg, savedPetMsg]
        .map(m => `${m.sender === 'user' ? 'User' : pet.name}: ${m.content}`)
        .join('\n');

      const extractionPromise = memoryService.extractAndStoreMemories({
        sessionDialogue: recentSessionText,
        pet,
        user
      });

      if (waitForMemory) {
        extractedMemories = await extractionPromise.catch(err => {
          console.warn('[DialogueService] Memory extraction failed:', err.message);
          return [];
        });
      } else {
        // Fire-and-forget in background so chat reply is returned immediately
        extractionPromise.then(newMems => {
          if (newMems && newMems.length > 0) {
            console.log(`[MemoryService] Background memory saved (${newMems.length}):`, newMems.map(m => `[${m.category}] ${m.content}`));
          }
        }).catch(err => {
          console.warn('[DialogueService] Background memory extraction error:', err.message);
        });
      }
    }

    // 12. Return full response
    return {
      userMessage: savedUserMsg,
      petResponse: savedPetMsg,
      emotion: updatedEmotion,
      growth: updatedGrowth,
      userEmotion: detectedUserEmotion,
      ethicalSafeguard: safeguard,
      extractedMemories,
      worldContext: {
        mode: todayWorld.mode,
        scheduleCount: todayWorld.schedules?.length || 0,
        relevantMemoriesCount: relevantMemories.length
      }
    };
  }
};
