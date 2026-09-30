// Pure request builders for the local Ollama model. main.js adds the JSON format and sends them.
// history: [{ es, en, reply: { reply_es, reply_en } | null }], oldest first.

const MODEL = 'gemma4:e4b';
const HISTORY_TURNS = 10;

function formatHistory(history) {
  return history.slice(-HISTORY_TURNS).map((t) => {
    let s = `Customer: ${t.es}`;
    if (t.reply) s += `\nUser replied: ${t.reply.reply_es}`;
    return s;
  }).join('\n');
}

function chat(system, user, temperature) {
  return {
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: { temperature },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
}

const TRANSLATE_INSTRUCTIONS = 'You translate Spanish from a live customer call into natural English. The Spanish is a speech-to-text transcript and may contain recognition errors; translate the most likely intended meaning. Output only the English translation, nothing else.';

function buildTranslateRequest(text, history) {
  const recent = formatHistory(history.slice(-4));
  return chat(TRANSLATE_INSTRUCTIONS, (recent ? `Recent conversation (for context only):\n${recent}\n\n` : '') + `Translate:\n${text}`, 0.2);
}

const DRAFT_INSTRUCTIONS = `You help the user hold a live voice conversation with a Spanish-speaking customer. The user does not speak Spanish well; they will read your reply aloud.

Given the conversation so far and the customer's latest message (a speech-to-text transcript that may contain recognition errors), draft what the user should say next.

- If the user's context below covers the question, answer from it accurately. Never invent prices, dates, policies or promises that are not in the context.
- If the context does not cover it, give a short, polite, generic reply: acknowledge, ask a clarifying question, or say you will check and follow up. Set used_context to false.
- Keep it to one to three short sentences that are easy to say out loud. Use natural, friendly Latin American Spanish.
- In reply_es, write numbers, prices and times as words (e.g. "ochenta y nueve dólares"), because the user reads it aloud.
- reply_es: the Spanish to say. reply_en: its English meaning.`;

function buildDraftRequest(text, history, contextText) {
  const ctx = contextText && contextText.trim()
    ? `<user_context>\n${contextText.trim()}\n</user_context>`
    : '(The user has provided no context file. Give polite, generic replies.)';
  const recent = formatHistory(history);
  return chat(`${DRAFT_INSTRUCTIONS}\n\n${ctx}`, (recent ? `Conversation so far:\n${recent}\n\n` : '') + `Customer's latest message:\n${text}`, 0.3);
}

module.exports = { buildTranslateRequest, buildDraftRequest, MODEL };
