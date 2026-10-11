// A soft two-note chime for "a decision is waiting": noticeable without sounding like an error or a siren.
// Browsers only allow sound after the person has interacted with the page; until then this quietly does nothing.
let ctx = null;

export function chime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (ctx.state !== 'running') return;
    const start = ctx.currentTime + 0.02;
    [[659.25, 0], [880, 0.18]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = start + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  } catch {
    // No Web Audio: the card still appears.
  }
}
