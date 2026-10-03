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

// Listen button: tap = auto-stop at a pause, hold = until release, double-tap = locked until the next tap.
// press/release return the action for the renderer: 'start' | 'auto' | 'lock' | 'stop' | null.
function createListenButton({ holdMs, doubleTapMs }) {
  let state = 'idle', pressAt = 0, tapAt = 0; // state: idle | pressing | auto | locked
  return {
    press(now) {
      if (state === 'idle') { state = 'pressing'; pressAt = now; return 'start'; }
      if (state === 'auto' && now - tapAt <= doubleTapMs) { state = 'locked'; return 'lock'; }
      if (state === 'auto' || state === 'locked') { state = 'idle'; return 'stop'; }
      return null;
    },
    release(now) {
      if (state !== 'pressing') return null;
      if (now - pressAt < holdMs) { state = 'auto'; tapAt = now; return 'auto'; }
      state = 'idle';
      return 'stop';
    },
    reset() { state = 'idle'; },
    autoStart() { state = 'auto'; tapAt = -Infinity; }, // auto-listen began without a tap
  };
}

if (typeof module !== 'undefined') module.exports = { createEndpointer, createListenButton };
