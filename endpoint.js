// Decides when auto-listen should stop: after speech followed by a pause, or at a hard cap.
// Shared by the renderer (plain <script>) and node tests.
function createEndpointer({ threshold, silenceMs, maxMs }) {
  let start = null, heardSpeech = false, lastLoud = 0;
  return {
    feed(rms, now) {
      if (start === null) start = now;
      if (rms >= threshold) { heardSpeech = true; lastLoud = now; }
      if (now - start >= maxMs) return 'stop';
      if (heardSpeech && now - lastLoud >= silenceMs) return 'stop';
      return 'continue';
    },
  };
}

if (typeof module !== 'undefined') module.exports = { createEndpointer };
