// Fuzzy "did I say it?" check: compares what Whisper heard from the user's mic with the Spanish they meant to say.
// Forgiving on purpose: accents, punctuation, a mispronounced or dropped word, or Whisper mishearing a beginner's accent
// still count. Shared by the renderer (plain <script>, so only one top-level name) and node tests.
// ponytail: word-level edit distance only; use a phonetic key (b/v, s/z/c, ll/y, silent h) if close attempts still miss.
const speechMatch = (() => {
  const words = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  const wordSim = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);

  // 0..1: how much of the target was said, in order. Each target word scores its similarity to the heard word it aligns with
  // (an LCS-style alignment, so extra words like "eh" or a restart don't hurt much). Lightly penalized when the heard
  // text is much longer than the target, so a long unrelated ramble can't match by containing a few of the words.
  function score(heard, target) {
    const h = words(heard), t = words(target);
    if (!t.length || !h.length) return 0;
    const dp = Array.from({ length: t.length + 1 }, () => new Array(h.length + 1).fill(0));
    for (let i = 1; i <= t.length; i++) {
      for (let j = 1; j <= h.length; j++) {
        const s = wordSim(t[i - 1], h[j - 1]);
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + (s >= 0.5 ? s : 0));
      }
    }
    const recall = dp[t.length][h.length] / t.length;
    const extra = Math.max(0, h.length - t.length * 1.5) / h.length;
    return Math.max(0, recall - extra * 0.5);
  }

  // Picks the best-matching target: [{ id, es }] -> { id, score } or null when nothing reaches the threshold.
  function best(heard, targets, threshold) {
    let top = null;
    for (const t of targets) {
      const s = score(heard, t.es);
      if (s >= threshold && (!top || s > top.score)) top = { id: t.id, score: s };
    }
    return top;
  }

  return { score, best, words };
})();

if (typeof module !== 'undefined') module.exports = speechMatch;
