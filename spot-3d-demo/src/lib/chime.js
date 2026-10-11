// A soft two-note chime for "a decision is waiting": noticeable without sounding like an error or a siren.
//
// Browsers keep audio suspended until the person interacts with the page, and a chime fires later from a timer, not
// from a click. So the audio context is created and woken on the first click or key press anywhere, and chime()
// waits for it to be running before scheduling the notes.
let ctx = null;

function context() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

function unlock() {
  const c = context();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { capture: true, passive: true });
}

function play(c) {
  const start = c.currentTime + 0.03;
  [[659.25, 0], [880, 0.2]].forEach(([freq, delay]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.85);
  });
}

/** Plays the chime. Resolves to true if it played, false if the browser still blocks sound (no click on the page yet). */
export async function chime() {
  try {
    const c = context();
    if (!c) return false;
    if (c.state !== 'running') await Promise.race([c.resume(), new Promise(r => setTimeout(r, 300))]);
    if (c.state !== 'running') return false;
    play(c);
    return true;
  } catch {
    return false; // no Web Audio: the card still appears
  }
}
