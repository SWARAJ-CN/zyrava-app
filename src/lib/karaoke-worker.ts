import { KARAOKE_CONNECTIONS, KARAOKE_SETTINGS } from "./karaoke";

export const KARAOKE_WORKER_VERSION = 4;
export const KARAOKE_CHUNK_BYTES = 131072;

export type KaraokePreparationProgress = {
  percent: number;
  stage: "starting" | "downloading" | "reading" | "decoding" | "processing" | "saving" | "ready";
};

/** Offline Web Audio runs in Expo Go's bundled WebView, never on the UI JS thread.
 * No microphone, server upload, or browser playback is involved.
 */
export function karaokeWorkerHtml(): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><script>
  let job;
  const post = value => window.ReactNativeWebView.postMessage(JSON.stringify({ ...value, job }));
  window.onerror = message => { post({ type: 'error', message: String(message) }); return true; };
  const routing = ${JSON.stringify(KARAOKE_CONNECTIONS)};
  const settings = ${JSON.stringify(KARAOKE_SETTINGS)};
  // Static script text is intentional: Hermes bytecode need not retain function source.
  function createStage(context) {
    const named = {};
    for (const name of ['input','output','mid','subtract','restore','correction']) named[name] = context.createGain();
    named.split = context.createChannelSplitter(2);
    named.stereo = context.createChannelMerger(2);
    named.bass = context.createBiquadFilter();
    named.bass.type = 'lowpass';
    named.bass.frequency.value = settings.bassHz;
    named.bass.Q.value = settings.bassQ;
    named.input.channelCount = 2;
    named.input.channelCountMode = 'explicit';
    named.mid.gain.value = 0.5;
    named.subtract.gain.value = 0;
    named.restore.gain.value = 0;
    for (const [from, to, output, input] of routing) named[from].connect(named[to], output, input);
    return {
      input: named.input, output: named.output,
      setEnabled(enabled) {
        const strength = enabled ? settings.strength : 0;
        named.subtract.gain.setTargetAtTime(-strength, context.currentTime, 0.04);
        named.restore.gain.setTargetAtTime(strength, context.currentTime, 0.04);
      },
      dispose() { for (const node of Object.values(named)) node.disconnect(); }
    };
  }
  let acknowledge;
  let started = false;
  let sequence = 0;
  window.acknowledgeChunk = (id, index) => {
    if (id === job && index === sequence && acknowledge) {
      const done = acknowledge; acknowledge = null; sequence++; done();
    }
  };
  async function send(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    await new Promise(resolve => { acknowledge = resolve; post({ type: 'chunk', index: sequence, bytes: bytes.length, data: btoa(binary) }); });
  }
  window.prepareKaraoke = async (encoded, id) => {
    if (started) return;
    started = true;
    job = id;
    let renderProgress;
    try {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw new Error('This phone does not support offline audio processing.');
      post({ type: 'progress', stage: 'decoding', percent: 30 });
      const binary = atob(encoded);
      encoded = null;
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoder = new Offline(2, 1, 22050);
      const audio = await decoder.decodeAudioData(bytes.buffer);
      if (!audio.duration || audio.duration > 600) throw new Error('Expo Go karaoke supports songs up to 10 minutes.');
      const context = new Offline(2, audio.length, audio.sampleRate);
      const source = context.createBufferSource();
      source.buffer = audio;
      const stage = createStage(context);
      stage.setEnabled(true);
      source.connect(stage.input);
      stage.output.connect(context.destination);
      source.start(0);
      post({ type: 'progress', stage: 'processing', percent: 40 });
      let lastPercent = 40;
      renderProgress = setInterval(() => {
        const percent = Math.min(69, 40 + Math.floor(30 * context.currentTime / audio.duration));
        if (percent > lastPercent) {
          lastPercent = percent;
          post({ type: 'progress', stage: 'processing', percent });
        }
      }, 500);
      const result = await context.startRendering();
      clearInterval(renderProgress);
      stage.dispose();
      const frames = result.length;
      post({ type: 'progress', stage: 'saving', percent: 70, totalBytes: 44 + frames * 4 });
      const header = new Uint8Array(44);
      const view = new DataView(header.buffer);
      const label = (at, value) => { for (let i = 0; i < value.length; i++) header[at+i] = value.charCodeAt(i); };
      label(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); label(8, 'WAVE'); label(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
      view.setUint32(24, result.sampleRate, true); view.setUint32(28, result.sampleRate * 4, true);
      view.setUint16(32, 4, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, frames * 4, true);
      await send(header);
      const left = result.getChannelData(0), right = result.getChannelData(1);
      for (let offset = 0; offset < frames; offset += ${KARAOKE_CHUNK_BYTES / 4}) {
        const count = Math.min(${KARAOKE_CHUNK_BYTES / 4}, frames - offset);
        const chunk = new Uint8Array(count * 4), pcm = new DataView(chunk.buffer);
        for (let i = 0; i < count; i++) {
          pcm.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[offset+i])) * 32767), true);
          pcm.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[offset+i])) * 32767), true);
        }
        await send(chunk);
      }
      post({ type: 'done', bytes: 44 + frames * 4, chunks: sequence });
    } catch (error) { post({ type: 'error', message: error.message || 'Could not prepare karaoke audio.' }); }
    finally { clearInterval(renderProgress); }
  };
  post({ type: 'ready', version: ${KARAOKE_WORKER_VERSION} });
  </script></body></html>`;
}
