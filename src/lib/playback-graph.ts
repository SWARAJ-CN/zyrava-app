import type {
  AudioContext,
  AudioTagHandle,
  AudioNode,
  MediaElementAudioSourceNode,
} from "react-native-audio-api";

/** The native <Audio> handle is stable even when its underlying file source changes. */
export function bindPlaybackSource(
  context: AudioContext,
  handle: AudioTagHandle,
  previous: AudioNode | null,
  input: AudioNode,
  analyser: AudioNode
): MediaElementAudioSourceNode {
  try {
    previous?.disconnect();
  } catch {
    // The loader may already have disposed the old native source.
  }
  const source = context.createMediaElementSource(handle);
  source.connect(input);
  source.connect(analyser);
  return source;
}

/** Keep the everyday EQ independent of expensive optional studio effects. */
export function createEqualizerChain(
  context: AudioContext,
  frequencies: number[],
  gains: number[],
  makeup: number
) {
  const filters = frequencies.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = frequency;
    filter.Q.value = 1;
    filter.gain.value = gains[index] ?? 0;
    return filter;
  });
  const trim = context.createGain();
  trim.gain.value = makeup;
  filters.forEach((filter, index) => filter.connect(filters[index + 1] ?? trim));
  return { filters, trim };
}
