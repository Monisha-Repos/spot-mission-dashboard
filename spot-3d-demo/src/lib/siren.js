/** Two-tone siren with the Web Audio API: 600 Hz / 900 Hz alternating every 0.4 s. No audio file needed. */
export function createSiren() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  // Must be created from a click: browsers block audio until the page has had a user gesture.
  const ctx = new Ctx();
  let osc = null, gain = null, timer = 0;
  return {
    get running() { return Boolean(osc); },
    start() {
      if (osc) return;
      ctx.resume();
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = 'square';
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      let high = false;
      osc.frequency.value = 600;
      timer = setInterval(() => {
        high = !high;
        osc.frequency.setValueAtTime(high ? 900 : 600, ctx.currentTime);
      }, 400);
      osc.start();
    },
    stop() {
      clearInterval(timer);
      if (osc) { osc.stop(); osc.disconnect(); gain.disconnect(); }
      osc = gain = null;
    },
    /** A short chirp so the operator hears that arming worked. */
    test() {
      ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 900;
      g.gain.value = 0.05;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    },
  };
}
