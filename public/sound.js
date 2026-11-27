const effects = {
  flip: ['flip-1', 'flip-2'],
  fan: ['fan'],
  place: ['place-1', 'place-2', 'place-3'],
  shuffle: ['shuffle'],
};

let enabled = true;
let context;
let output;
let playback = 0;
const clips = new Map();

async function loadClips() {
  await Promise.all(Object.values(effects).flat().map(async name => {
    try {
      const response = await fetch(`./assets/audio/${name}.mp3`);
      if (!response.ok) return;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      clips.set(name, buffer);
    } catch { /* Audio is optional when a browser cannot play a sound. */ }
  }));
}

export function setSoundEnabled(value) {
  enabled = value;
  if (output) output.gain.setTargetAtTime(enabled ? .73 : 0, context.currentTime, .015);
}

export function unlockSounds() {
  if (!enabled) return;
  try {
    if (!context) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = .73;
      output.connect(context.destination);
      loadClips();
    }
    if (context.state !== 'running') context.resume().catch(() => {});
  } catch { /* Gameplay stays available when audio is blocked. */ }
}

export function playSound(effect, { level = 1, delay = 0, pan = 0 } = {}) {
  if (!enabled || !output || context.state !== 'running') return;
  const variants = effects[effect].map(name => clips.get(name)).filter(Boolean);
  if (!variants.length) return;

  const variation = playback++;
  const source = context.createBufferSource();
  source.buffer = variants[variation % variants.length];
  source.playbackRate.value = 1 + (variation % 5 - 2) * .022;
  const gain = context.createGain();
  gain.gain.value = level;
  source.connect(gain);
  const panner = pan && context.createStereoPanner ? context.createStereoPanner() : null;
  if (panner) {
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(output);
  } else {
    gain.connect(output);
  }
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  source.start(context.currentTime + delay / 1000);
}
