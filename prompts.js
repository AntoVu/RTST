// Pure request builders for the local Ollama model. main.js adds JSON formats and sends them.
// history: [{ who: 'them' | 'me', es, en }], oldest first.
// Prompt order is kept stable (instructions, context, memory, transcript, newest message) so Ollama
// can reuse its cache for the unchanged prefix and only process the new tokens each turn.

const MODEL = 'gemma4:e4b';
const NUM_CTX = 16384; // must be identical on every request, or Ollama reloads the model
const MAX_MESSAGES = 200; // ponytail: hard cap on transcript length; summarize older turns if meetings run longer

const label = (m) => (m.who === 'me' ? 'You' : 'Them');

function formatHistory(history, withEnglish = false) {
  return history.slice(-MAX_MESSAGES).map((m) => {
    const en = withEnglish && m.en ? ` (${m.en})` : '';
    return `${label(m)}: ${m.es}${en}`;
  }).join('\n');
}

function chat(system, user, temperature) {
  return {
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: { temperature, num_ctx: NUM_CTX },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
}

function background(contextText, memoryText) {
  let s = contextText && contextText.trim()
    ? `<user_context>\n${contextText.trim()}\n</user_context>`
    : '(The user has provided no context file.)';
  if (memoryText && memoryText.trim()) s += `\n\n<memory_from_past_meetings>\n${memoryText.trim()}\n</memory_from_past_meetings>`;
  return s;
}

const TRANSLATE_INSTRUCTIONS = 'You translate Spanish from a live conversation into natural English. The Spanish is a speech-to-text transcript and may contain recognition errors; translate the most likely intended meaning. Output only the English translation, nothing else.';

function buildTranslateRequest(text, history) {
  const recent = formatHistory(history.slice(-4));
  return chat(TRANSLATE_INSTRUCTIONS, (recent ? `Recent conversation (for context only):\n${recent}\n\n` : '') + `Translate:\n${text}`, 0.2);
}

const SPEAKING_RULES = `The user is a beginner-intermediate Spanish student who reads your Spanish aloud. Use simple, common words, short sentences, and mostly the present tense. Write numbers and times as words (e.g. "veinte años"). Follow the tone the context asks for.`;

const DRAFT_INSTRUCTIONS = `You help the user hold a live Spanish conversation. Given the conversation so far and the other person's latest message, write exactly what the user says next, in the first person, like a real person talking.

- Their message is a speech-to-text transcript: it may be cut off mid-sentence or have misheard words. Read it in light of the current topic (e.g. while talking about classes, "frase" probably means "clase").
- If they asked something, answer it directly first, with the facts from the context (don't copy numbers from their question). Never ask them what they just asked you.
- Don't end with a question unless they said "¿y tú?" or the topic is finished. Never repeat a question already asked in this conversation, and stay on their topic.
- Remember everything said in this conversation (names, details, what was already discussed) and stay consistent with it.
- Answer from the user's context and the memory from past meetings. Never invent facts about the user that are not there. Simple small talk (the weather, how you are) can get an ordinary answer; otherwise say something short and honest like "No estoy seguro." or "Creo que sí.".
- One or two short sentences. Calm and friendly, not overly enthusiastic.
- ${SPEAKING_RULES}
- reply_es: the Spanish to say. reply_en: its English meaning.`;

// avoid: earlier drafts for this message the user refreshed away. They go at the very end, after the stable prefix,
// so a refresh still reuses the cache; temperature goes up for variety (it's a sampling option, so no model reload).
function buildDraftRequest(text, history, contextText, memoryText, avoid = []) {
  const recent = formatHistory(history);
  const others = avoid.filter(Boolean);
  return chat(
    `${DRAFT_INSTRUCTIONS}\n\n${background(contextText, memoryText)}`,
    (recent ? `Conversation so far:\n${recent}\n\n` : '') + `Their latest message:\n${text}` +
      (others.length ? `\n\nThe user rejected these replies. Write a new one that does NOT reuse their sentences: change the wording and sentence structure, or mention a different detail from the context, or add a short follow-up question.\n${others.map((s) => `- ${s}`).join('\n')}` : ''),
    others.length ? 0.8 : 0.3,
  );
}

const PHRASE_INSTRUCTIONS = `You help the user hold a live Spanish conversation. The user typed, in English (or rough Spanish), something they want to say next. Write it as natural spoken Spanish they can read aloud, in the first person, keeping their meaning. Don't add facts or questions they didn't ask for.
- Use the conversation so far to choose the right words, names, and tú/usted.
- ${SPEAKING_RULES}
- es: the Spanish to say. en: its English meaning.`;

// The conversation goes first and the typed text last; there's no context or memory, so this prompt stays short.
function buildPhraseRequest(english, history) {
  const recent = formatHistory(history.slice(-12));
  return chat(PHRASE_INSTRUCTIONS, (recent ? `Conversation so far:\n${recent}\n\n` : '') + `What the user wants to say:\n${english}`, 0.2);
}

const SUGGEST_INSTRUCTIONS = `You help the user hold a live Spanish conversation. Suggest 5 different things the user could say next: questions or comments that fit their context, goals and the conversation so far (for example follow-up questions about what the other person just said, or topics the context says to cover that haven't come up yet). Don't repeat what has already been said.
- ${SPEAKING_RULES}
- Each suggestion: es (the Spanish) and en (its English meaning).`;

function buildSuggestRequest(history, contextText, memoryText) {
  const recent = formatHistory(history);
  return chat(
    `${SUGGEST_INSTRUCTIONS}\n\n${background(contextText, memoryText)}`,
    recent ? `Conversation so far:\n${recent}` : 'The conversation has not started yet.',
    0.7,
  );
}

const SUMMARY_INSTRUCTIONS = `Summarize this conversation as notes the user can rely on in future meetings with the same people. Write up to 10 short English bullet points ("- ..."): people's names and personal details they shared, topics covered, anything promised or to follow up on. Output only the bullets.`;

function buildSummaryRequest(history) {
  return chat(SUMMARY_INSTRUCTIONS, `Conversation:\n${formatHistory(history, true)}`, 0.2);
}

// The context file's "# Sidebar questions" section becomes a sidebar category:
// "- Spanish | English" lines, grouped by deeper subheadings. It ends at the next heading of the same or higher level.
function parseSidebarQuestions(contextText) {
  const groups = [];
  let level = 0; // heading level of the section; 0 = not inside it
  for (const line of (contextText || '').split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && /^sidebar questions$/i.test(h[2])) level = h[1].length;
      else if (level) groups.push({ title: h[2], items: [] });
      continue;
    }
    const item = level && line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!item) continue;
    if (!groups.length) groups.push({ title: null, items: [] });
    const [es, en = ''] = item[1].split(/\s+\|\s+/);
    groups.at(-1).items.push({ es, en });
  }
  return groups.filter((g) => g.items.length);
}

// The context file minus its "# Sidebar questions" section: those lists are for the user, and as prompt text they only
// add noise and tokens.
function stripSidebarQuestions(contextText) {
  const kept = [];
  let level = 0; // heading level of the section being skipped; 0 = keeping lines
  for (const line of (contextText || '').split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h && level && h[1].length <= level) level = 0;
    if (h && !level && /^sidebar questions$/i.test(h[2])) level = h[1].length;
    if (!level) kept.push(line);
  }
  return kept.join('\n');
}

module.exports = { buildTranslateRequest, buildDraftRequest, buildPhraseRequest, buildSuggestRequest, buildSummaryRequest, formatHistory, parseSidebarQuestions, stripSidebarQuestions, MODEL, NUM_CTX };
