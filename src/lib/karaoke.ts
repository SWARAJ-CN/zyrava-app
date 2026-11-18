import type { AudioContext, AudioNode } from "react-native-audio-api";

// Shared serializable routing keeps the native and Expo Go processors identical.
export const KARAOKE_SETTINGS = { strength: 0.9, bassHz: 140, bassQ: Math.SQRT1_2 };
export const KARAOKE_CONNECTIONS = [
  ["input", "output", 0, 0],
  ["input", "split", 0, 0],
  ["split", "mid", 0, 0],
  ["split", "mid", 1, 0],
  ["mid", "subtract", 0, 0],
  ["mid", "bass", 0, 0],
  ["bass", "restore", 0, 0],
  ["subtract", "correction", 0, 0],
  ["restore", "correction", 0, 0],
  ["correction", "stereo", 0, 0],
  ["correction", "stereo", 0, 1],
  ["stereo", "output", 0, 0],
] as const;

/** Stereo center reduction, with centered bass restored below 140 Hz.
 * This reduces centered instruments too; it is not vocal stem separation.
 * Out L/R = L/R - strength * mid + strength * lowpass(mid).
 */
export function createKaraokeStage(context: AudioContext) {
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const dispose = () => {
    nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* detached */
      }
    });
  };
  try {
    const input = keep(context.createGain());
    input.channelCount = 2;
    input.channelCountMode = "explicit";
    const output = keep(context.createGain());
    const split = keep(context.createChannelSplitter(2));
    const mid = keep(context.createGain());
    mid.gain.value = 0.5;
    const subtract = keep(context.createGain());
    const bass = keep(context.createBiquadFilter());
    bass.type = "lowpass";
    bass.frequency.value = KARAOKE_SETTINGS.bassHz;
    bass.Q.value = KARAOKE_SETTINGS.bassQ;
    const restore = keep(context.createGain());
    const correction = keep(context.createGain());
    const stereo = keep(context.createChannelMerger(2));
    subtract.gain.value = 0;
    restore.gain.value = 0;

    const named = { input, output, split, mid, subtract, bass, restore, correction, stereo };
    for (const [from, to, out, port] of KARAOKE_CONNECTIONS) {
      named[from].connect(named[to], out, port);
    }

    return {
      input,
      output,
      dispose,
      setEnabled(enabled: boolean) {
        // Retain a little center signal; mono tracks must not become silent.
        const strength = enabled ? KARAOKE_SETTINGS.strength : 0;
        subtract.gain.setTargetAtTime(-strength, context.currentTime, 0.04);
        restore.gain.setTargetAtTime(strength, context.currentTime, 0.04);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Static WebView source: Hermes builds do not preserve Function.toString(). */
export function liveKaraokeScript(): string {
  return `function createLiveKaraokeStage(context) {
    var named={},settings=${JSON.stringify(KARAOKE_SETTINGS)},routing=${JSON.stringify(KARAOKE_CONNECTIONS)};
    ['input','output','mid','subtract','restore','correction'].forEach(function(name){named[name]=context.createGain();});
    named.split=context.createChannelSplitter(2);named.stereo=context.createChannelMerger(2);
    named.bass=context.createBiquadFilter();named.bass.type='lowpass';named.bass.frequency.value=settings.bassHz;named.bass.Q.value=settings.bassQ;
    named.input.channelCount=2;named.input.channelCountMode='explicit';named.mid.gain.value=0.5;
    named.subtract.gain.value=0;named.restore.gain.value=0;
    routing.forEach(function(edge){named[edge[0]].connect(named[edge[1]],edge[2],edge[3]);});
    return {input:named.input,output:named.output,setEnabled:function(enabled){
      var strength=enabled?settings.strength:0;
      named.subtract.gain.setTargetAtTime(-strength,context.currentTime,0.04);
      named.restore.gain.setTargetAtTime(strength,context.currentTime,0.04);
    }};
  }`;
}
