"use strict";

// Stadium atmosphere synthesised in the browser with the Web Audio API (no audio files),
// plus an optional commentator voice using the browser's built-in speech synthesis.
const Sound = (() => {
  const BASE = 0.16;          // crowd murmur level while the match runs
  let ctx = null, master, crowd, crowdTone, enabled = false, voice = true, running = false, lastWhistle = 0;

  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch (_) { /* storage blocked */ } };
  voice = pref("pc_voice", true);

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);

    // Crowd: looping brown noise through a band-pass, with a slow swaying murmur.
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(6); src.loop = true;
    crowdTone = ctx.createBiquadFilter(); crowdTone.type = "bandpass"; crowdTone.frequency.value = 650; crowdTone.Q.value = 0.7;
    crowd = ctx.createGain(); crowd.gain.value = 0;
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.11; lfoGain.gain.value = 0.035; lfo.connect(lfoGain).connect(crowd.gain);
    src.connect(crowdTone).connect(crowd).connect(master);
    src.start(); lfo.start();
  }

  function level(target, rampS = 1.2) {
    if (!ctx) return;
    const t = ctx.currentTime, g = crowd.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(target, t + rampS);
  }

  // Short rise of the crowd (an "ooh" for a chance, a roar for a goal), then back to the murmur.
  function swell(peak, holdS, tone = 1300) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, g = crowd.gain, f = crowdTone.frequency;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + 0.25); g.setValueAtTime(peak, t + holdS);
    g.linearRampToValueAtTime(running ? BASE : 0, t + holdS + 2.5);
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(tone, t + 0.25); f.linearRampToValueAtTime(650, t + holdS + 2.5);
  }

  // Referee's pea whistle: two close tones with a fast warble.
  function whistle(pattern = [0.25]) {
    if (!ctx || !enabled) return;
    const now = ctx.currentTime;
    if (now - lastWhistle < 1) return;
    lastWhistle = now;
    let t = now + 0.02;
    pattern.forEach((dur) => {
      const g = ctx.createGain(), trem = ctx.createOscillator(), tremGain = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03);
      g.gain.setValueAtTime(0.09, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
      trem.frequency.value = 32; tremGain.gain.value = 0.035; trem.connect(tremGain).connect(g.gain);
      [2850, 3020].forEach((hz) => { const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(g); o.start(t); o.stop(t + dur); });
      trem.start(t); trem.stop(t + dur);
      g.connect(master);
      t += dur + 0.18;
    });
  }

  // Broadcast "on air" sting: a filtered whoosh and a two-note chime.
  function sting() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.6);
    const hp = ctx.createBiquadFilter(); hp.type = "bandpass"; hp.Q.value = 1.2;
    hp.frequency.setValueAtTime(400, t); hp.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.25, t + 0.2); ng.gain.linearRampToValueAtTime(0, t + 0.5);
    n.connect(hp).connect(ng).connect(master); n.start(t);
    [[880, 0.35], [1320, 0.47]].forEach(([hz, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = hz;
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.12, t + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.6);
      o.connect(g).connect(master); o.start(t + at); o.stop(t + at + 0.65);
    });
  }

  function speak(text) {
    if (!enabled || !voice || !("speechSynthesis" in window) || !text) return;
    const synth = window.speechSynthesis;
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\bxG\b/g, "expected goals").replace(/\bkm\/h\b/g, "kilometres per hour"));
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang === "en-GB") || voices.find((v) => v.lang.startsWith("en")) || null;
    u.lang = "en-GB"; u.rate = 1.07; u.volume = 1;
    synth.speak(u);
  }

  function setRunning(isRunning) {
    running = isRunning;
    if (enabled) level(isRunning ? BASE : 0, isRunning ? 2 : 0.8);
  }

  function setEnabled(on) {
    enabled = on;
    save("pc_sound", on);
    if (on) { init(); ctx?.resume(); level(running ? BASE : 0, 1.5); }
    else { level(0, 0.4); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }
  }

  function setVoice(on) { voice = on; save("pc_voice", on); if (!on && "speechSynthesis" in window) window.speechSynthesis.cancel(); }

  return {
    get enabled() { return enabled; },
    get voice() { return voice; },
    wantedByDefault: () => pref("pc_sound", true),
    setEnabled, setVoice, setRunning, swell, whistle, sting, speak,
  };
})();
