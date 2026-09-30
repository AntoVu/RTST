// Pure request builders for the Claude calls. main.js adds the output format and sends them.
// history: [{ es, en, reply: { reply_es, reply_en } | null }], oldest first.

const HISTORY_TURNS = 10;

function formatHistory(history) {
  return history.slice(-HISTORY_TURNS).map((t) => {
    let s = `Customer: ${t.es}`;
    if (t.reply) s += `\nUser replied: ${t.reply.reply_es}`;
    return s;
  }).join('\n');
}

function buildTranslateRequest(text, history) {
  const recent = formatHistory(history.slice(-4));
  const content = (recent ? `Recent conversation (for context only):\n${recent}\n\n` : '') + `Translate:\n${text}`;
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: 'You translate Spanish from a live customer call into natural English. The Spanish is a speech-to-text transcript and may contain recognition errors; translate the most likely intended meaning. Output only the English translation, nothing else.',
    messages: [{ role: 'user', content }],
  };
}

const DRAFT_INSTRUCTIONS = `You help the user hold a live voice conversation with a Spanish-speaking customer. The user does not speak Spanish; they will read your reply aloud.

Given the conversation so far and the customer's latest message (a speech-to-text transcript that may contain recognition errors), draft what the user should say next.

- If the user's context below covers the question, answer from it accurately. Never invent prices, dates, policies or promises that are not in the context.
- If the context does not cover it, give a short, polite, generic reply: acknowledge, ask a clarifying question, or say you will check and follow up. Set used_context to false.
- Keep it to one to three short sentences that are easy to say out loud. Use natural, friendly Latin American Spanish.
- reply_es: the Spanish to say. pronunciation: an English-speaker phonetic spelling of reply_es with stressed syllables in CAPS (e.g. "BWEH-nos DEE-ahs"). reply_en: the English meaning.`;

function buildDraftRequest(text, history, contextText) {
  const ctx = contextText && contextText.trim()
    ? `<user_context>\n${contextText.trim()}\n</user_context>`
    : '(The user has provided no context file. Give polite, generic replies.)';
  const recent = formatHistory(history);
  const content = (recent ? `Conversation so far:\n${recent}\n\n` : '') + `Customer's latest message:\n${text}`;
  return {
    model: 'claude-opus-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: DRAFT_INSTRUCTIONS },
      { type: 'text', text: ctx, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content }],
  };
}

module.exports = { buildTranslateRequest, buildDraftRequest };
