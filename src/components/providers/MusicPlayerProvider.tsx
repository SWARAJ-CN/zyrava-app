import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import type {
  AudioContext,
  AudioTagHandle,
  AudioNode as RnAudioNode,
  AudioParam as RnAudioParam,
  AudioBuffer as RnAudioBuffer,
  BiquadFilterNode,
  GainNode,
  StereoPannerNode,
  WaveShaperNode,
  AnalyserNode as RnAnalyserNode,
} from "react-native-audio-api";
import { getAudioEngine } from "@/lib/audio-engine";
import {
  configureGoAudioMode,
  createGoAudioTransport,
  type AudioTransport,
  type AudioTransportCallbacks,
} from "@/lib/go-audio";
import type { Song } from "@/lib/saavn";
import { searchSongs } from "@/lib/saavn";
import { playbackKind, buildRadioFor, type FetchPool } from "@/lib/taste";
import { useTaste } from "@/components/providers/TasteProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import { useGuestLock } from "@/components/providers/GuestLockProvider";
import { playPad as firePad, type PadName } from "@/lib/dj/pads";
import { onAudioInterruption, deactivateAudioSession } from "@/lib/wake-info";
import { getItem, setItem } from "@/lib/store";

/*
 * The engine loads through the lazy shim (see audio-engine.ts): in a binary
 * without react-native-audio-api — Expo Go — `engine` is simply null. The
 * app still boots, browses, chats and reads lyrics. Playback itself then
 * runs on the expo-audio transport (lib/go-audio.ts), and only the
 * studio-grade graph — EQ, FX rack, spatial, analyser, pads — degrades to
 * clearly-labelled inactive controls instead of a crash wall.
 */
const engine = getAudioEngine();
const AudioTagComponent = engine?.Audio ?? null;
const notify = engine?.PlaybackNotificationManager ?? null;
/** True when playback must ride the Expo Go transport (no native engine). */
const goBackend = engine === null;

/* ------------------------------------------------------------------ *
 * Native port of the web MusicPlayerProvider.
 *
 * The graph, queue semantics, transport, recovery ladder, watchdog, taste
 * logging, auto-feed and every exported constant are preserved verbatim.
 * Platform swaps only:
 *  • `<audio>` element  → react-native-audio-api `<Audio>` tag (same
 *    play/pause/seek/volume/rate handle, position + lifecycle events).
 *  • MediaSession       → PlaybackNotificationManager (metadata, transport
 *    buttons, seek events — a 1:1 mapping of the web handlers).
 *  • CORS probe         → gone: native networking has no tainting, so the
 *    graph and the analyser are always live (`visualizerReady` stays true).
 *  • DynamicsCompressor → `ApproxCompressor`: the same threshold/ratio/knee/
 *    attack/release parameter surface driving a waveshaper soft-knee curve
 *    (the native engine has no compressor node yet; settings round-trip).
 *  • navigator.locks / autoplay unlock / iOS hidden-graph release → handled
 *    by the OS audio session (AudioManager) and AppState instead.
 * ------------------------------------------------------------------ */

/* ── DJ rig — repeat modes, the effect-rack wet levels and the FX names. ── */
export type RepeatMode = "off" | "all" | "one";

/** Every launch starts clean: master at 1% (raised only by the listener),
 *  Flat EQ, space off. */
export const DEFAULT_VOLUME = 0.01;

/** What a visitor who has not signed in gets to hear: one page of tracks. */
export const GUEST_PLAY_LIMIT = 10;

/** Slider → loudness curve (fifth-power perceived-loudness mapping). */
export function appliedVolume(slider: number): number {
  return slider <= 0 ? 0 : Math.pow(slider, 0.2);
}

function masterLevel(volume: number, muted: boolean, preampDb: number): number {
  return muted ? 0 : appliedVolume(volume) * Math.pow(10, -Math.max(0, preampDb) / 20);
}

function eqMakeupGain(gains: number[]): number {
  const maxBoost = Math.max(0, ...gains);
  const rms = Math.sqrt(gains.reduce((sum, g) => sum + g * g, 0) / gains.length);
  return Math.pow(10, -(maxBoost + rms) / 2 / 20);
}

export const FX_ORDER = [
  "echo",
  "reverb",
  "flanger",
  "chorus",
  "phaser",
  "drive",
  "roll",
  "stutter",
] as const;
export type FxName = (typeof FX_ORDER)[number];
export type FxLevels = Record<FxName, number>;

export const FX_LABELS: Record<FxName, string> = {
  echo: "Echo",
  reverb: "Reverb",
  flanger: "Flanger",
  chorus: "Chorus",
  phaser: "Phaser",
  drive: "Distortion",
  roll: "Beat roll",
  stutter: "Stutter",
};

interface FxStage {
  input: GainNode;
  output: GainNode;
  dry: GainNode;
  wet: GainNode;
}

/* ── Equalizer — ten peaking filters wired into the audio graph. ── */
export const EQ_BANDS = [
  { frequency: 31, label: "31" },
  { frequency: 62, label: "62" },
  { frequency: 125, label: "125" },
  { frequency: 250, label: "250" },
  { frequency: 500, label: "500" },
  { frequency: 1000, label: "1k" },
  { frequency: 2000, label: "2k" },
  { frequency: 4000, label: "4k" },
  { frequency: 8000, label: "8k" },
  { frequency: 16000, label: "16k" },
];

export interface EqPreset {
  label: string;
  gains: number[];
  /** Heavy-duty profiles ask before engaging — big lows want a warning. */
  heavy?: boolean;
}

/*
 * Ten-band presets — each array maps onto EQ_BANDS, low → high.
 * Values stay within ±12 dB so the sum can never clip the bus.
 */
export const EQ_PRESETS: EqPreset[] = [
  { label: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: "Bass boost", gains: [9, 7.5, 5, 2.5, 0, -0.5, -1, -1, 0, 0.5], heavy: true },
  { label: "Sub bass", gains: [11, 9, 4, 1, 0, 0, 0, -0.5, -1, -1.5], heavy: true },
  { label: "Vocal", gains: [-2, -2.5, -1, 1.5, 3.5, 4.5, 4, 2, 0.5, 0] },
  { label: "Acoustic", gains: [2, 3, 1.5, 0.5, 2, 1.5, 2.5, 3, 2.5, 1] },
  { label: "Treble", gains: [-1, -1.5, -2, -1, 0, 1, 2.5, 4.5, 6.5, 7.5] },
  { label: "Party", gains: [7, 6, 3, 1, -1, 0.5, 1.5, 2.5, 4.5, 5.5] },
  { label: "Soft", gains: [2.5, 1.5, 0, -2.5, -4, -1.5, 0.5, 1.5, 2.5, 3.5] },
  { label: "Rock", gains: [6, 5, 3, 0.5, -1, -0.5, 1.5, 3.5, 5, 5.5] },
  { label: "Pop", gains: [-1, 1, 3, 4, 2.5, 0, -1.5, -1, 1.5, 2] },
  { label: "Hip hop", gains: [9, 8, 2, 3, -1, -1.5, 1, 2, 3.5, 2], heavy: true },
  { label: "Dance", gains: [9, 6, 2, -0.5, 2, 3.5, 4, 2.5, 0, 0] },
  { label: "Classical", gains: [5, 4, 2.5, 0.5, -1.5, -1.5, 0, 1.5, 2.5, 4] },
  { label: "Podcast", gains: [-6, -5, -2.5, 1, 4, 5.5, 3, 1.5, -1, -3] },
  { label: "Late night", gains: [3, 2.5, 1, 0, -0.5, -1, -1.5, -0.5, 1.5, 2] },
  {
    label: "Boom bass",
    gains: [12, 10.5, 6.5, 1.5, -2, -0.5, 0, 1, 2, 2.5],
    heavy: true,
  },
  {
    label: "Party hall PA",
    gains: [11, 9.5, 5.5, 1, -2, 0, 2, 3.5, 4.5, 5.5],
    heavy: true,
  },
  {
    label: "Tourist bus",
    gains: [12, 11.5, 8, 2.5, -2.5, -1, 0, 2, 3, 4],
    heavy: true,
  },
];

export const BASS_PRESET_LABEL = "Bass boost";

/** Auto recommendation feed switch: remembered like the rest of the studio. */
const AUTO_FEED_KEY = "zyrava:auto-feed";

function readAutoFeed(): boolean {
  try {
    return getItem(AUTO_FEED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Immersive playback modes wired in between the EQ and the analyser. */
export type SpatialMode =
  | "off"
  | "stereo"
  | "mono"
  | "wide"
  | "8d"
  | "3d"
  | "surround"
  | "stack"
  | "pan"
  | "telephone"
  | "echo";

export const SPATIAL_MODES: { value: SpatialMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Raw stream" },
  { value: "stereo", label: "Stereo", hint: "Standard two-channel" },
  { value: "mono", label: "Mono", hint: "Both channels summed" },
  { value: "wide", label: "Wide", hint: "Extra-wide stereo field" },
  { value: "8d", label: "8D", hint: "Slow orbit around your head" },
  { value: "3d", label: "3D", hint: "HRTF room feel" },
  { value: "surround", label: "Surround", hint: "Widened stereo field" },
  { value: "stack", label: "PA stack", hint: "Mono sub, stereo tops" },
  { value: "pan", label: "Auto pan", hint: "Fast ping-pong pan" },
  { value: "telephone", label: "Telephone", hint: "Restrained AM-radio band" },
  { value: "echo", label: "Echo", hint: "Warm space tail" },
];

/** All FX slots silent — the console's starting point. */
const FX_SILENCE: FxLevels = {
  echo: 0,
  reverb: 0,
  flanger: 0,
  chorus: 0,
  phaser: 0,
  drive: 0,
  roll: 0,
  stutter: 0,
};

/* ------------------------------------------------------------------ *
 * ApproxCompressor — DynamicsCompressorNode is not in the native engine
 * yet, so the bus-dynamics slots keep the FULL web parameter surface
 * (threshold/ratio/knee/attack/release, all gliding) but realise the
 * curve as a static soft-knee waveshaper derived from those values.
 * Above the knee the gain follows `thr + overshoot / ratio`, tanh-
 * normalised; a bypassed stage is the identity curve. Settings from the
 * console round-trip unchanged and the switch stays audible.
 * ------------------------------------------------------------------ */
interface ParamShim {
  value: number;
  setTargetAtTime(value: number, startTime?: number, timeConstant?: number): void;
}

class ApproxCompressor {
  readonly node: GainNode | WaveShaperNode;
  private readonly shaper: WaveShaperNode | null;
  private readonly thresholdLin = { value: 1 };
  threshold: ParamShim;
  ratio: ParamShim;
  knee: ParamShim;
  attack: ParamShim;
  release: ParamShim;

  constructor(
    private readonly context: AudioContext,
    node: GainNode | WaveShaperNode,
    shaper: WaveShaperNode | null
  ) {
    this.node = node;
    this.shaper = shaper;
    const rebuild = () => this.rebuildCurve();
    const make = (initial: number, onChange: () => void): ParamShim => ({
      value: initial,
      setTargetAtTime(value: number) {
        this.value = value;
        onChange();
      },
    });
    this.threshold = make(0, rebuild);
    this.ratio = make(1, rebuild);
    this.knee = make(30, rebuild);
    this.attack = make(0.003, rebuild);
    this.release = make(0.25, rebuild);
  }

  private rebuildCurve(): void {
    if (!this.shaper) return;
    const { threshold, ratio, knee } = this;
    // ratio ~1 and threshold ~0 dB → transparent identity curve.
    if (ratio.value <= 1.01 || threshold.value >= 0) {
      this.shaper.curve = identityCurve();
      return;
    }
    const thr = Math.pow(10, threshold.value / 20);
    const kneeWidth = Math.min(0.5, Math.max(0, knee.value / 40));
    const size = 1024;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      const x = (i / (size - 1)) * 2 - 1;
      const mag = Math.abs(x);
      const soft = mag > thr * (1 - kneeWidth) ? thr * (1 - kneeWidth) : mag;
      const overshoot = Math.max(0, mag - thr);
      const shaped = thr + overshoot / ratio.value;
      const kneeBlend = mag > thr * (1 - kneeWidth) && mag < thr ? (mag - thr * (1 - kneeWidth)) / (thr * kneeWidth || 1) : 1;
      curve[i] = Math.sign(x) * Math.min(1, shaped * (kneeBlend || 1) || soft);
    }
    this.shaper.curve = curve;
  }

  /* attack/release are stored for the day the native engine ships a real
     compressor; until then the static knee is time-independent. */
  get nativeBacked(): boolean {
    return false;
  }
}

let identityCurveCache: Float32Array | null = null;
function identityCurve(): Float32Array {
  if (!identityCurveCache) {
    identityCurveCache = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) {
      identityCurveCache[i] = (i / 1023) * 2 - 1;
    }
  }
  return identityCurveCache;
}

function createCompressorStage(
  context: AudioContext,
  withShaper: boolean
): ApproxCompressor {
  const node = context.createGain();
  if (!withShaper) return new ApproxCompressor(context, node, null);
  const shaper = context.createWaveShaper();
  node.connect(shaper);
  return new ApproxCompressor(context, shaper, shaper);
}

/**
 * Synthesized wet-noise impulse for the reverb convolver (unit-energy
 * normalised so the wet crossfade alone decides how much room is heard).
 */
function makeReverbIr(context: AudioContext, seconds = 1.4, decay = 2.6): RnAudioBuffer {
  const rate = context.sampleRate;
  const length = Math.floor(seconds * rate);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let energy = 0;
    for (let sample = 0; sample < length; sample += 1) {
      const value = (Math.random() * 2 - 1) * Math.pow(1 - sample / length, decay);
      data[sample] = value;
      energy += value * value;
    }
    const normalize = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let sample = 0; sample < length; sample += 1) data[sample] *= normalize;
  }
  return buffer;
}

/** Tanh transfer curve for the distortion drive (0 → clean, 1 → crushed). */
function driveCurve(amount: number): Float32Array {
  const size = 1024;
  const curve = new Float32Array(size);
  const drive = 1 + amount * 40;
  const norm = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const x = (index / (size - 1)) * 2 - 1;
    curve[index] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/**
 * Waits between the attempts to take a track back: a quick one for a hiccup,
 * a patient one for a device that was asleep.
 */
const PLAYBACK_RETRY_AFTER = [150, 700, 1800, 4000, 9000];

/** Milliseconds between two watchdog checks of a playing track. */
const WATCHDOG_EVERY = 6_000;

interface MusicPlayerValue {
  queue: Song[];
  queueLabel: string;
  index: number;
  current: Song | null;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  playerError: string | null;
  visualizerReady: boolean;
  /** Spotify-style "Now playing" preview (a full-screen route on mobile). */
  nowPlayingOpen: boolean;
  setNowPlayingOpen: (open: boolean) => void;
  eqPreset: string;
  eqGains: number[];
  spatialMode: SpatialMode;
  getAnalyser: () => RnAnalyserNode | null;
  startQueue: (list: Song[], label: string, position: number) => void;
  /** Append the next batch to the running queue (deduped by track id). */
  appendQueue: (list: Song[]) => void;
  /** Registers the handler asked for more tracks when a queue runs out. */
  setQueueEnd: (handler: (() => boolean) | null) => void;
  togglePlay: () => void;
  stepTrack: (direction: 1 | -1) => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  setMuted: (value: boolean) => void;
  applyPreset: (preset: EqPreset) => void;
  /** Call after a manual band move so the preset name stops claiming a curve. */
  markEqCustom: (gains: number[]) => void;
  /** Restore the saved custom curve and keep its label. */
  applyCustomPreset: () => void;
  setEqGains: (gains: number[]) => void;
  setSpatialMode: (mode: SpatialMode) => void;
  /** Studio mixer — gain, balance and tempo ride the audio graph. */
  preampDb: number;
  setPreampDb: (value: number) => void;
  balance: number;
  setBalance: (value: number) => void;
  rate: number;
  setRate: (value: number) => void;
  /** Dock rail ⇄ wide state (the mobile drawer's remembered layout). */
  sidebarWide: boolean;
  setSidebarWide: (wide: boolean) => void;
  /** Dashboard telemetry: seconds heard and tracks queued this session. */
  listenedSeconds: number;
  sessionPlays: number;
  /** Live graph facts for the dashboard. */
  getGraphInfo: () => {
    webAudio: boolean;
    sampleRate: number | null;
    channels: number | null;
  };
  /** True stereo level pairs for the console's VU meters. */
  getLevels: () => [number, number];
  /** Low-cut (rumble/hiss) stage engaged. */
  loCut: boolean;
  setLoCut: (on: boolean) => void;
  /* ── DJ transport ── */
  repeat: RepeatMode;
  cycleRepeat: () => void;
  shuffle: boolean;
  toggleShuffle: () => void;
  /** Taste-driven queue top-ups while playing (the sparkle switch near shuffle). */
  autoFeed: boolean;
  toggleAutoFeed: () => void;
  stop: () => void;
  /** Stop, clear the queue and close the studio panels (sign-out). */
  endSession: () => void;
  jumpTo: (position: number) => void;
  /** End-fade transition length in seconds (Auto DJ hand-off). */
  crossfade: number;
  setCrossfade: (value: number) => void;
  /* ── DJ effect rack (wet levels 0..1) ── */
  fx: FxLevels;
  setFx: (patch: Partial<FxLevels>) => void;
  /** Filter sweep: −1 high-pass gate … 0 neutral … +1 low-pass fade. */
  sweep: number;
  setSweep: (value: number) => void;
  /** Dedicated sub-bass shelf ±12 dB around 55 Hz. */
  subDb: number;
  setSubDb: (value: number) => void;
  /** Bus dynamics. */
  compAmt: number;
  setCompAmt: (value: number) => void;
  limiterOn: boolean;
  setLimiterOn: (on: boolean) => void;
  loudnessOn: boolean;
  setLoudnessOn: (on: boolean) => void;
  /** One-tap party pads, synthesized straight on the audio context. */
  playPad: (name: PadName) => void;
  /** Full-screen hardware console. */
  mixerOpen: boolean;
  setMixerOpen: (open: boolean) => void;
  /** The dock drawer open state. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const MusicPlayerContext = createContext<MusicPlayerValue | null>(null);

/*
 * Native engine context — one per provider lifetime. The web graph was
 * created lazily for CORS reasons and torn down on iOS backgrounding; on
 * device the OS audio session keeps the graph alive across navigation, so
 * the provider simply owns this singleton. Re-acquired if the provider is
 * ever remounted.
 */
let sharedContext: AudioContext | null = null;
function acquireContext(): AudioContext | null {
  if (!sharedContext && engine) {
    try {
      sharedContext = new engine.AudioContext();
    } catch (error) {
      // A context that refuses to start leaves every graph feature off;
      // the transport still plays through the element's own volume.
      console.warn(
        `[zyrava] audio context unavailable — ${error instanceof Error ? error.message : String(error)}`
      );
      sharedContext = null;
    }
  }
  return sharedContext;
}
function releaseContext(): void {
  sharedContext = null;
}

/**
 * Renders inside the `<Audio>` tag so the provider can read the native
 * element's `duration`/`ready` (the tag exposes them through context).
 */
function AudioMetaBridge({
  onMeta,
}: {
  onMeta: (duration: number, ready: boolean) => void;
}): null {
  // Only ever mounted inside <Audio>, which only exists when the engine does.
  const tag = engine?.useAudioTagContext();
  useEffect(() => {
    if (tag) onMeta(tag.duration, tag.ready);
  }, [tag, onMeta]);
  return null;
}

/**
 * App-wide music playback.
 *
 * Lives beside the data providers (not inside the music routes) so the queue
 * and the native audio element survive navigation — switching tabs keeps the
 * music running, and the OS media controls hand the lock screen / notification
 * transport.
 */
export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const { openPlaybackUrl } = useOffline();
  const { isGuest, requestLogin } = useGuestLock();
  const [queue, setQueue] = useState<Song[]>([]);
  const [queueLabel, setQueueLabel] = useState("");
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [muted, setMutedState] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [eqPreset, setEqPreset] = useState("Flat");
  const [eqGains, setEqGains] = useState<number[]>([...EQ_PRESETS[0].gains]);
  /** The user's own ten-band curve, saved separately from the factory presets. */
  const [customEqGains, setCustomEqGains] = useState<number[]>([...EQ_PRESETS[0].gains]);
  const [spatialMode, setSpatialModeState] = useState<SpatialMode>("off");
  /* Native truth: the graph (and its analyser tap) is live from the first
     frame — no CORS probe gates it, unlike the web's lazy upgrade path. */
  // The analyser exists from the first loaded track onward.
  const [visualizerReady, setVisualizerReady] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpenState] = useState(false);

  /* Studio mixer values — refs mirror them so the graph reads the freshest
   * value the moment nodes are built. */
  const [preampDb, setPreampDbState] = useState(0);
  const [balance, setBalanceState] = useState(0);
  const [rate, setRateState] = useState(1);
  const preampDbRef = useRef(preampDb);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const balanceRef = useRef(balance);
  const rateRef = useRef(rate);

  /* Session telemetry for the dashboard. */
  const [listenedSeconds, setListenedSeconds] = useState(0);
  const [sessionPlays, setSessionPlays] = useState(0);
  const lastTickRef = useRef(0);

  /* DJ transport — repeat / shuffle / transition hand-off. */
  const [repeat, setRepeatState] = useState<RepeatMode>("off");
  const [shuffle, setShuffleState] = useState(false);
  const [crossfade, setCrossfadeState] = useState(0);
  const crossfadeRef = useRef(crossfade);

  /* Auto recommendation feed — taste-driven queue top-ups while it plays. */
  const [autoFeed, setAutoFeedState] = useState(readAutoFeed);
  const autoFeedBusyRef = useRef(false);

  /* DJ effect rack + dynamics + sweep/sub trim. */
  const [fx, setFxState] = useState<FxLevels>({ ...FX_SILENCE });
  const [sweep, setSweepState] = useState(0);
  const [subDb, setSubDbState] = useState(0);
  const [compAmt, setCompAmtState] = useState(0);
  const [limiterOn, setLimiterOnState] = useState(false);
  const [loudnessOn, setLoudnessOnState] = useState(false);

  /* The FX rack / dynamics nodes, captured at graph build. */
  const djInRef = useRef<GainNode | null>(null);
  const djOutRef = useRef<GainNode | null>(null);
  const fxStagesRef = useRef<Map<FxName, FxStage> | null>(null);
  const subShelfRef = useRef<BiquadFilterNode | null>(null);
  const sweepLpRef = useRef<BiquadFilterNode | null>(null);
  const sweepHpRef = useRef<BiquadFilterNode | null>(null);
  const compRef = useRef<ApproxCompressor | null>(null);
  const limitRef = useRef<ApproxCompressor | null>(null);
  const loudLowRef = useRef<BiquadFilterNode | null>(null);
  const loudHighRef = useRef<BiquadFilterNode | null>(null);
  const padBusRef = useRef<GainNode | null>(null);
  /** Stutter amplitude node pair + the distortion shaper. */
  const stGainRef = useRef<GainNode | null>(null);
  const stDepthRef = useRef<GainNode | null>(null);
  const shaperRef = useRef<WaveShaperNode | null>(null);

  /* The left dock: rail ⇄ wide dashboard. Wide is the desktop default. */
  const [sidebarWide, setSidebarWideState] = useState(true);
  /* The full-screen hardware console. */
  const [mixerOpen, setMixerOpenState] = useState(false);
  /* The dock as a drawer. */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** Post-balance stereo meter taps for the console's VU bridge. */
  const metersRef = useRef<[RnAnalyserNode | null, RnAnalyserNode | null]>([null, null]);
  /** The node the routing currently feeds — reconnects only on real changes. */
  const routeTargetRef = useRef<RnAudioNode | null>(null);
  /** Low-cut stage state + mirror for the graph build. */
  const [loCut, setLoCutState] = useState(false);
  const loCutRef = useRef(loCut);
  /** The high-pass node for the low-cut stage in the graph. */
  const loCutNodeRef = useRef<BiquadFilterNode | null>(null);

  /* ── Native media element ──
   * The `<Audio>` tag is the singleton; commands go through its handle, the
   * source flows through React state (a prop swap reloads it like `src=`). */
  const audioRef = useRef<AudioTagHandle | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const sourceRefForState = useRef<string | null>(null);
  /** Element position/ended mirrors — the native handle has no live getters. */
  const positionRef = useRef(0);
  const endedRef = useRef(false);
  const pausedRef = useRef(true);
  const readyRef = useRef(false);
  const durationRef = useRef(0);
  const lastProgressCommitRef = useRef(0);

  /** The one graph context — native audio has no gesture gate, so it is
   *  created at mount (the web built it lazily only for CORS reasons). */
  const [context] = useState<AudioContext | null>(acquireContext);

  const analyserRef = useRef<RnAnalyserNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  /** Post-EQ trim that cancels the curve's biggest boost (makeup gain). */
  const eqTrimRef = useRef<GainNode | null>(null);
  /** Post-rack trim cancelling sub/loudness/compression gain the same way. */
  const busTrimRef = useRef<GainNode | null>(null);
  /** The one true volume control — final stage before the speakers. */
  const masterGainRef = useRef<GainNode | null>(null);
  const eqGainsRef = useRef<number[]>(eqGains);
  /** Fixed entry/exit gains that the spatial FX rewire between. */
  const spaceInRef = useRef<GainNode | null>(null);
  const spaceOutRef = useRef<GainNode | null>(null);
  /** The mixer section every route passes through: gain then balance. */
  const preampNodeRef = useRef<GainNode | null>(null);
  const panNodeRef = useRef<StereoPannerNode | null>(null);
  /** Stops LFOs / disconnects the current spatial chain. */
  const spatialCleanupRef = useRef<() => void>(() => {});
  const spatialModeRef = useRef<SpatialMode>(spatialMode);
  /** The element's tap into the audio graph (created per mounted element). */
  const mediaSourceRef = useRef<RnAudioNode | null>(null);
  /** The `<Audio>` handle the tap was created from — element identity, so a
   *  remount (endSession → new track) re-attaches instead of reusing a dead node. */
  const elementRef = useRef<AudioTagHandle | null>(null);
  // Play intent is read at track-switch time; state would force the loader
  // effect to re-run on clicks.
  const shouldPlayRef = useRef(false);
  /** Whether the preview panel's first auto-open has already happened. */
  const panelShownRef = useRef(false);
  /** The DJ rack present between the mixer head and the output. */
  const rackReadyRef = useRef(false);
  const rackBuildingRef = useRef(false);
  /** Built on demand by applyRouting and the DJ-engagement watcher. */
  const ensureRackRef = useRef<() => void>(() => {});
  /** Any DJ feature engaged — the mirror that decides the rack gets built. */
  const djEngagedRef = useRef(false);
  /** The loader for the active track — the stall watchdog re-runs it. */
  const startStreamRef = useRef<(() => void) | null>(null);
  /** Automatic re-arms the active track has already burned. */
  const streamFailuresRef = useRef(0);
  /** A freshly resolved stream URL for one whose link went bad. */
  const freshUrlRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);
  /** The active row as a render-stable mirror for interval callbacks. */
  const currentRef = useRef<Song | null>(null);

  useEffect(() => {
    eqGainsRef.current = eqGains;
  }, [eqGains]);

  /** What the rack exists for right now — read by applyRouting and the loader. */
  useEffect(() => {
    djEngagedRef.current =
      fx.echo > 0 ||
      fx.reverb > 0 ||
      fx.flanger > 0 ||
      fx.chorus > 0 ||
      fx.phaser > 0 ||
      fx.drive > 0 ||
      fx.roll > 0 ||
      fx.stutter > 0 ||
      sweep !== 0 ||
      subDb !== 0 ||
      compAmt > 0 ||
      limiterOn ||
      loudnessOn;
  }, [fx, sweep, subDb, compAmt, limiterOn, loudnessOn]);

  const current = queue[index] ?? null;

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  /**
   * Rewires the spatial section between `spaceIn` and `spaceOut` for the
   * active mode — identical chains to the web graph (all node types exist
   * natively: splitter/merger/panner/LFO/biquad/delay).
   */
  const applySpatial = useCallback(() => {
    const ctx = context;
    const input = spaceInRef.current;
    const output = spaceOutRef.current;
    if (!ctx || !input || !output) return;

    spatialCleanupRef.current();
    spatialCleanupRef.current = () => {};
    input.disconnect();

    const mode = spatialModeRef.current;
    if (mode === "off" || mode === "stereo") {
      input.connect(output);
      return;
    }

    try {
      if (mode === "mono") {
        const splitter = ctx.createChannelSplitter(2);
        const sum = ctx.createGain();
        const halfL = ctx.createGain();
        const halfR = ctx.createGain();
        halfL.gain.value = 0.5;
        halfR.gain.value = 0.5;
        splitter.connect(halfL, 0);
        splitter.connect(halfR, 1);
        halfL.connect(sum);
        halfR.connect(sum);
        input.connect(splitter);
        sum.connect(output);
        spatialCleanupRef.current = () => {
          try {
            splitter.disconnect();
            halfL.disconnect();
            halfR.disconnect();
            sum.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        return;
      }

      if (mode === "8d") {
        const panner = ctx.createStereoPanner();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.type = "sine";
        lfo.frequency.value = 0.08;
        depth.gain.value = 0.95;
        lfo.connect(depth);
        depth.connect(panner.pan);
        input.connect(panner);
        panner.connect(output);
        lfo.start();
        spatialCleanupRef.current = () => {
          try {
            lfo.stop();
            lfo.disconnect();
            depth.disconnect();
            panner.disconnect();
          } catch {
            /* already stopped */
          }
        };
        return;
      }

      if (mode === "3d") {
        const panner = ctx.createPanner();
        /* The native engine's panner is equalpower for now (HRTF is on the
           library roadmap); the binaural drift below carries the 3D feel. */
        panner.distanceModel = "inverse";
        panner.refDistance = 0.5;
        panner.rolloffFactor = 0.4;
        panner.positionZ.value = -0.9;
        panner.positionY.value = -0.1;
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.type = "sine";
        lfo.frequency.value = 0.05;
        depth.gain.value = 1.8;
        lfo.connect(depth);
        depth.connect(panner.positionX);
        input.connect(panner);
        panner.connect(output);
        lfo.start();
        spatialCleanupRef.current = () => {
          try {
            lfo.stop();
            lfo.disconnect();
            depth.disconnect();
            panner.disconnect();
          } catch {
            /* already stopped */
          }
        };
        return;
      }

      if (mode === "stack") {
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const subL = ctx.createGain();
        const subR = ctx.createGain();
        const subSum = ctx.createGain();
        const subLow = ctx.createBiquadFilter();
        const topL = ctx.createGain();
        const topR = ctx.createGain();
        subL.gain.value = 0.5;
        subR.gain.value = 0.5;
        subLow.type = "lowpass";
        subLow.frequency.value = 130;
        subLow.Q.value = 0.7;
        topL.gain.value = 0.95;
        topR.gain.value = 0.95;
        splitter.connect(subL, 0);
        splitter.connect(subR, 1);
        subL.connect(subSum);
        subR.connect(subSum);
        subSum.connect(subLow);
        subLow.connect(merger, 0, 0);
        subLow.connect(merger, 0, 1);
        splitter.connect(topL, 0);
        splitter.connect(topR, 1);
        topL.connect(merger, 0, 0);
        topR.connect(merger, 0, 1);
        input.connect(splitter);
        merger.connect(output);
        spatialCleanupRef.current = () => {
          try {
            splitter.disconnect();
            merger.disconnect();
            subL.disconnect();
            subR.disconnect();
            subSum.disconnect();
            subLow.disconnect();
            topL.disconnect();
            topR.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        return;
      }

      if (mode === "wide") {
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const straightL = ctx.createGain();
        const straightR = ctx.createGain();
        const crossL = ctx.createGain();
        const crossR = ctx.createGain();
        straightL.gain.value = 0.85;
        straightR.gain.value = 0.85;
        crossL.gain.value = -0.45;
        crossR.gain.value = -0.45;
        splitter.connect(straightL, 0);
        splitter.connect(crossR, 0);
        splitter.connect(straightR, 1);
        splitter.connect(crossL, 1);
        straightL.connect(merger, 0, 0);
        crossL.connect(merger, 0, 0);
        crossR.connect(merger, 0, 1);
        straightR.connect(merger, 0, 1);
        input.connect(splitter);
        merger.connect(output);
        spatialCleanupRef.current = () => {
          try {
            splitter.disconnect();
            merger.disconnect();
            straightL.disconnect();
            straightR.disconnect();
            crossL.disconnect();
            crossR.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        return;
      }

      if (mode === "pan") {
        const panner = ctx.createStereoPanner();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.type = "sine";
        lfo.frequency.value = 0.45;
        depth.gain.value = 0.7;
        lfo.connect(depth);
        depth.connect(panner.pan);
        input.connect(panner);
        panner.connect(output);
        lfo.start();
        spatialCleanupRef.current = () => {
          try {
            lfo.stop();
            lfo.disconnect();
            depth.disconnect();
            panner.disconnect();
          } catch {
            /* already stopped */
          }
        };
        return;
      }

      if (mode === "telephone") {
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1400;
        band.Q.value = 1.1;
        const level = ctx.createGain();
        level.gain.value = 1.6;
        input.connect(band);
        band.connect(level);
        level.connect(output);
        spatialCleanupRef.current = () => {
          try {
            band.disconnect();
            level.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        return;
      }

      if (mode === "echo") {
        const dry = ctx.createGain();
        dry.gain.value = 0.85;
        const delay = ctx.createDelay(1.2);
        delay.delayTime.value = 0.32;
        const damp = ctx.createBiquadFilter();
        damp.type = "lowpass";
        damp.frequency.value = 3200;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.38;
        const wet = ctx.createGain();
        wet.gain.value = 0.5;
        input.connect(dry);
        dry.connect(output);
        input.connect(delay);
        delay.connect(damp);
        damp.connect(feedback);
        feedback.connect(delay);
        damp.connect(wet);
        wet.connect(output);
        spatialCleanupRef.current = () => {
          try {
            dry.disconnect();
            delay.disconnect();
            damp.disconnect();
            feedback.disconnect();
            wet.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        return;
      }

      // Surround: cross-bled Haas widener.
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const ghostToRight = ctx.createDelay(0.05);
      const ghostToLeft = ctx.createDelay(0.05);
      ghostToRight.delayTime.value = 0.018;
      ghostToLeft.delayTime.value = 0.018;
      const bleedRight = ctx.createGain();
      const bleedLeft = ctx.createGain();
      bleedRight.gain.value = 0.32;
      bleedLeft.gain.value = 0.32;

      input.connect(splitter);
      splitter.connect(merger, 0, 0);
      splitter.connect(merger, 1, 1);
      splitter.connect(ghostToRight, 0);
      ghostToRight.connect(bleedRight);
      bleedRight.connect(merger, 0, 1);
      splitter.connect(ghostToLeft, 1);
      ghostToLeft.connect(bleedLeft);
      bleedLeft.connect(merger, 0, 0);
      merger.connect(output);
      spatialCleanupRef.current = () => {
        try {
          splitter.disconnect();
          ghostToRight.disconnect();
          ghostToLeft.disconnect();
          bleedRight.disconnect();
          bleedLeft.disconnect();
          merger.disconnect();
        } catch {
          /* already disconnected */
        }
      };
    } catch {
      // Node types unavailable — stay silent-equivalent (direct).
      input.connect(output);
    }
  }, [context]);

  /**
   * Parameter worker for the whole DJ rack — identical values and glide
   * policy to the web graph.
   */
  const applyFX = useCallback(() => {
    const ctx = context;
    if (!ctx) return;
    const glide = (param: RnAudioParam | ParamShim, value: number, tc = 0.04) =>
      param.setTargetAtTime(value, ctx.currentTime, tc);
    const stages = fxStagesRef.current;
    if (stages) {
      FX_ORDER.forEach((name) => {
        const stage = stages.get(name);
        if (!stage) return;
        const wet = Math.min(1, Math.max(0, fx[name]));
        const blendIn = name === "flanger" || name === "chorus" || name === "phaser";
        glide(stage.dry.gain, blendIn ? 1 : 1 - wet * 0.85);
        glide(stage.wet.gain, blendIn ? wet * 0.7 : wet);
      });
    }
    if (shaperRef.current) shaperRef.current.curve = driveCurve(fx.drive);
    if (sweepLpRef.current && sweepHpRef.current) {
      const lp = sweepLpRef.current;
      const hp = sweepHpRef.current;
      if (sweep <= 0) {
        glide(lp.frequency, 20000, 0.03);
        glide(hp.frequency, 20 + Math.pow(-sweep, 1.6) * 3000, 0.03);
      } else {
        glide(hp.frequency, 20, 0.03);
        glide(lp.frequency, Math.max(300, 20000 * Math.pow(0.015, sweep)), 0.03);
      }
    }
    if (subShelfRef.current) glide(subShelfRef.current.gain, subDb);
    if (stGainRef.current && stDepthRef.current) {
      const depth = Math.min(0.5, fx.stutter * 0.45);
      glide(stGainRef.current.gain, 1 - depth);
      glide(stDepthRef.current.gain, depth);
    }
    const comp = compRef.current;
    if (comp) {
      if (compAmt <= 0) {
        comp.threshold.setTargetAtTime(0);
        comp.ratio.setTargetAtTime(1);
        comp.knee.setTargetAtTime(30);
      } else {
        comp.threshold.setTargetAtTime(-2 - 36 * compAmt);
        comp.ratio.setTargetAtTime(1 + 11 * compAmt);
        comp.knee.setTargetAtTime(8);
        comp.attack.setTargetAtTime(0.004);
        comp.release.setTargetAtTime(0.18);
      }
    }
    const limit = limitRef.current;
    if (limit) {
      if (!limiterOn) {
        limit.threshold.setTargetAtTime(0);
        limit.ratio.setTargetAtTime(1);
        limit.knee.setTargetAtTime(30);
      } else {
        limit.threshold.setTargetAtTime(-2);
        limit.ratio.setTargetAtTime(20);
        limit.knee.setTargetAtTime(0);
        limit.attack.setTargetAtTime(0.001);
        limit.release.setTargetAtTime(0.07);
      }
    }
    if (loudLowRef.current) glide(loudLowRef.current.gain, loudnessOn ? 4 : 0);
    if (loudHighRef.current) glide(loudHighRef.current.gain, loudnessOn ? 2.5 : 0);
    if (busTrimRef.current) {
      const addedDb = Math.max(0, subDb) + (loudnessOn ? 4 : 0) + compAmt * 6;
      glide(busTrimRef.current.gain, Math.pow(10, -addedDb / 20));
    }
  }, [fx, sweep, subDb, compAmt, limiterOn, loudnessOn, context]);

  useEffect(() => {
    applyFX();
  }, [applyFX]);

  /** Picks the head's route — light path until the rack earns its place. */
  const applyRouting = useCallback(() => {
    const ctx = context;
    const head = loCutNodeRef.current;
    if (!ctx || !head) return;
    const eqOn = eqGainsRef.current.some((gain) => gain !== 0);
    const spaceOn =
      spatialModeRef.current !== "off" && spatialModeRef.current !== "stereo";
    if ((eqOn || spaceOn || djEngagedRef.current) && !rackReadyRef.current) {
      ensureRackRef.current();
    }
    const target: RnAudioNode =
      filtersRef.current.length > 0
        ? filtersRef.current[0]
        : djOutRef.current ?? ctx.destination;
    if (routeTargetRef.current === target) return;
    if (routeTargetRef.current) {
      try {
        head.disconnect(routeTargetRef.current);
      } catch {
        /* already detached */
      }
    }
    try {
      head.connect(target);
      routeTargetRef.current = target;
    } catch {
      /* routing unavailable */
    }
  }, [context]);

  /**
   * Wires the graph once — light form first (source → pre-amp → balance →
   * low-cut → djOut → master → speakers, with the analyser + stereo meter
   * taps off the way they sit on the web). The heavy rack splices in later.
   */
  const ensureGraph = useCallback((): RnAnalyserNode | null => {
    const handle = audioRef.current;
    const ctx = context;
    if (!ctx) return null;
    if (!handle) return null;
    // Already wired to this very element — nothing to do.
    if (analyserRef.current && elementRef.current === handle) return analyserRef.current;
    // The element remounted (source cleared between tracks): take the old
    // tap out of the graph before the new handle claims its slot.
    if (mediaSourceRef.current && elementRef.current !== handle) {
      try {
        mediaSourceRef.current.disconnect();
      } catch {
        /* already detached */
      }
      mediaSourceRef.current = null;
      analyserRef.current = null;
    }
    try {
      const mediaSource = ctx.createMediaElementSource(handle);
      mediaSourceRef.current = mediaSource;
      elementRef.current = handle;
      const sourceNode: RnAudioNode = mediaSource;
      const preamp = ctx.createGain();
      preamp.gain.value = Math.pow(10, preampDbRef.current / 20);
      const panNode = ctx.createStereoPanner();
      panNode.pan.value = balanceRef.current;
      const loCutNode = ctx.createBiquadFilter();
      loCutNode.type = "highpass";
      loCutNode.frequency.value = loCutRef.current ? 40 : 4;
      sourceNode.connect(preamp);
      preamp.connect(panNode);
      panNode.connect(loCutNode);

      const djOut = ctx.createGain();
      djOut.gain.value = 1;
      loCutNode.connect(djOut);
      const masterGain = ctx.createGain();
      masterGain.gain.value = masterLevel(
        volumeRef.current,
        mutedRef.current,
        preampDbRef.current
      );
      djOut.connect(masterGain);
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;
      // The master node owns the level from here.
      handle.setVolume(1);
      handle.setMuted(false);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      sourceNode.connect(analyser);

      const meterSplit = ctx.createChannelSplitter(2);
      const meterL = ctx.createAnalyser();
      const meterR = ctx.createAnalyser();
      meterL.fftSize = 1024;
      meterR.fftSize = 1024;
      meterL.smoothingTimeConstant = 0;
      meterR.smoothingTimeConstant = 0;
      panNode.connect(meterSplit);
      meterSplit.connect(meterL, 0);
      meterSplit.connect(meterR, 1);
      metersRef.current = [meterL, meterR];

      const padBus = ctx.createGain();
      padBus.gain.value = 0.9;
      padBus.connect(masterGain);
      padBusRef.current = padBus;

      analyserRef.current = analyser;
      preampNodeRef.current = preamp;
      panNodeRef.current = panNode;
      loCutNodeRef.current = loCutNode;
      djOutRef.current = djOut;
      djInRef.current = null;
      filtersRef.current = [];
      spaceInRef.current = null;
      spaceOutRef.current = null;
      fxStagesRef.current = null;
      subShelfRef.current = null;
      sweepLpRef.current = null;
      sweepHpRef.current = null;
      compRef.current = null;
      limitRef.current = null;
      loudLowRef.current = null;
      loudHighRef.current = null;
      stGainRef.current = null;
      stDepthRef.current = null;
      shaperRef.current = null;
      routeTargetRef.current = djOut;
      rackReadyRef.current = false;
      rackBuildingRef.current = false;
      applyFX();
      applyRouting();
      return analyser;
    } catch {
      analyserRef.current = null;
      return null;
    }
  }, [applyRouting, applyFX, context]);

  /**
   * The heavy section, spliced between the mixer head and djOut — EQ ladder,
   * makeup trim, spatial section, then the serial power chain
   * djIn → sub → sweep → FX slots → stutter → dynamics → loudness → trim →
   * djOut. Identical values to the web rack.
   */
  const ensureRack = useCallback((): boolean => {
    const ctx = context;
    if (!ctx) return false;
    if (rackReadyRef.current) return true;
    if (rackBuildingRef.current) return false;
    const output = djOutRef.current;
    const head = loCutNodeRef.current;
    if (!output || !head) return false;
    rackBuildingRef.current = true;

    try {
      const filters = EQ_BANDS.map((band, bandIndex) => {
        const filter = ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = band.frequency;
        filter.Q.value = 1;
        filter.gain.value = eqGainsRef.current[bandIndex];
        return filter;
      });
      const spaceIn = ctx.createGain();
      const spaceOut = ctx.createGain();
      const eqTrim = ctx.createGain();
      eqTrim.gain.value = eqMakeupGain(eqGainsRef.current);
      let node: RnAudioNode = filters[0];
      for (let filterIndex = 1; filterIndex < filters.length; filterIndex += 1) {
        node.connect(filters[filterIndex]);
        node = filters[filterIndex];
      }
      node.connect(eqTrim);
      eqTrim.connect(spaceIn);

      const djIn = ctx.createGain();

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = "lowshelf";
      subShelf.frequency.value = 55;
      subShelf.gain.value = 0;

      const sweepLp = ctx.createBiquadFilter();
      sweepLp.type = "lowpass";
      sweepLp.frequency.value = 20000;
      sweepLp.Q.value = 0.71;
      const sweepHp = ctx.createBiquadFilter();
      sweepHp.type = "highpass";
      sweepHp.frequency.value = 20;
      sweepHp.Q.value = 0.71;

      const comp = createCompressorStage(ctx, true);
      const limit = createCompressorStage(ctx, true);
      const loudLow = ctx.createBiquadFilter();
      loudLow.type = "lowshelf";
      loudLow.frequency.value = 100;
      const loudHigh = ctx.createBiquadFilter();
      loudHigh.type = "highshelf";
      loudHigh.frequency.value = 11000;

      const mkStage = (): FxStage => {
        const stageInput = ctx.createGain();
        const stageOutput = ctx.createGain();
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        dry.gain.value = 1;
        wet.gain.value = 0;
        stageInput.connect(dry);
        dry.connect(stageOutput);
        wet.connect(stageOutput);
        return { input: stageInput, output: stageOutput, dry, wet };
      };
      const stages = new Map<FxName, FxStage>();
      (
        ["echo", "reverb", "flanger", "chorus", "phaser", "drive", "roll"] as const
      ).forEach((name) => {
        stages.set(name, mkStage());
      });

      const echoDelay = ctx.createDelay(1.5);
      echoDelay.delayTime.value = 0.31;
      const echoFb = ctx.createGain();
      echoFb.gain.value = 0.42;
      echoDelay.connect(echoFb);
      echoFb.connect(echoDelay);
      stages.get("echo")!.input.connect(echoDelay);
      echoDelay.connect(stages.get("echo")!.wet);

      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbIr(ctx);
      stages.get("reverb")!.input.connect(convolver);
      convolver.connect(stages.get("reverb")!.wet);

      const flDelay = ctx.createDelay(0.05);
      flDelay.delayTime.value = 0.003;
      const flFb = ctx.createGain();
      flFb.gain.value = 0.5;
      flDelay.connect(flFb);
      flFb.connect(flDelay);
      const flLfo = ctx.createOscillator();
      flLfo.frequency.value = 0.16;
      const flDepth = ctx.createGain();
      flDepth.gain.value = 0.0022;
      flLfo.connect(flDepth);
      flDepth.connect(flDelay.delayTime);
      stages.get("flanger")!.input.connect(flDelay);
      flDelay.connect(stages.get("flanger")!.wet);
      flLfo.start();

      const chorusWet = ctx.createGain();
      (
        [
          [0.017, 0.48, 0.005],
          [0.026, 0.34, 0.0065],
        ] as [number, number, number][]
      ).forEach(([time, lfoRate, depth]) => {
        const delay = ctx.createDelay(0.05);
        delay.delayTime.value = time;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const chorusDepth = ctx.createGain();
        chorusDepth.gain.value = depth;
        lfo.connect(chorusDepth);
        chorusDepth.connect(delay.delayTime);
        stages.get("chorus")!.input.connect(delay);
        delay.connect(chorusWet);
        lfo.start();
      });
      chorusWet.connect(stages.get("chorus")!.wet);

      const phLfo = ctx.createOscillator();
      phLfo.frequency.value = 0.3;
      const phDepth = ctx.createGain();
      phDepth.gain.value = 520;
      phLfo.connect(phDepth);
      let phNode: RnAudioNode = stages.get("phaser")!.input;
      [280, 740, 1700, 2800].forEach((freq) => {
        const allPass = ctx.createBiquadFilter();
        allPass.type = "allpass";
        allPass.frequency.value = freq;
        allPass.Q.value = 1.4;
        phDepth.connect(allPass.frequency);
        phNode.connect(allPass);
        phNode = allPass;
      });
      phNode.connect(stages.get("phaser")!.wet);
      phLfo.start();

      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(0);
      stages.get("drive")!.input.connect(shaper);
      shaper.connect(stages.get("drive")!.wet);

      const rollDelay = ctx.createDelay(1);
      rollDelay.delayTime.value = 0.166;
      const rollDamp = ctx.createBiquadFilter();
      rollDamp.type = "lowpass";
      rollDamp.frequency.value = 4200;
      rollDamp.Q.value = 0.7;
      const rollFb = ctx.createGain();
      rollFb.gain.value = 0.5;
      rollDelay.connect(rollDamp);
      rollDamp.connect(rollFb);
      rollFb.connect(rollDelay);
      stages.get("roll")!.input.connect(rollDelay);
      rollDelay.connect(stages.get("roll")!.wet);

      const stGain = ctx.createGain();
      stGain.gain.value = 1;
      const stLfo = ctx.createOscillator();
      stLfo.type = "square";
      stLfo.frequency.value = 3.4;
      const stDepth = ctx.createGain();
      stDepth.gain.value = 0;
      stLfo.connect(stDepth);
      stDepth.connect(stGain.gain);
      stLfo.start();

      let chain: RnAudioNode = djIn;
      const link = (stage: RnAudioNode) => {
        chain.connect(stage);
        chain = stage;
      };
      link(subShelf);
      link(sweepLp);
      link(sweepHp);
      (
        ["echo", "reverb", "flanger", "chorus", "phaser", "drive", "roll"] as const
      ).forEach((name) => {
        const stage = stages.get(name)!;
        chain.connect(stage.input);
        chain = stage.output;
      });
      link(stGain);
      link(comp.node);
      link(limit.node);
      link(loudLow);
      link(loudHigh);
      const busTrim = ctx.createGain();
      chain.connect(busTrim);
      busTrim.connect(output);
      spaceOut.connect(djIn);

      try {
        head.disconnect(output);
      } catch {
        /* not wired */
      }

      filtersRef.current = filters;
      eqTrimRef.current = eqTrim;
      busTrimRef.current = busTrim;
      djInRef.current = djIn;
      subShelfRef.current = subShelf;
      sweepLpRef.current = sweepLp;
      sweepHpRef.current = sweepHp;
      compRef.current = comp;
      limitRef.current = limit;
      loudLowRef.current = loudLow;
      loudHighRef.current = loudHigh;
      fxStagesRef.current = stages;
      stGainRef.current = stGain;
      stDepthRef.current = stDepth;
      shaperRef.current = shaper;
      spaceInRef.current = spaceIn;
      spaceOutRef.current = spaceOut;
      routeTargetRef.current = null;
      rackReadyRef.current = true;

      applySpatial();
      applyFX();
      applyRouting();
      return true;
    } catch {
      rackReadyRef.current = false;
      return false;
    } finally {
      rackBuildingRef.current = false;
    }
  }, [applySpatial, applyRouting, applyFX, context]);

  useEffect(() => {
    ensureRackRef.current = ensureRack;
  }, [ensureRack]);

  // The tag unmounted (endSession): drop the per-element graph state so the
  // next mount rebuilds cleanly in its own onLoad.
  useEffect(() => {
    if (source) return; // the tag is still mounted — nothing to release
    spatialCleanupRef.current();
    spatialCleanupRef.current = () => {};
    try {
      mediaSourceRef.current?.disconnect();
    } catch {
      /* already detached */
    }
    mediaSourceRef.current = null;
    elementRef.current = null;
    analyserRef.current = null;
    // visualizerReady flips back on with the next onLoad wiring; readers of
    // getAnalyser() already idle-drift on null, like the web's fallback.
  }, [source]);

  /* Native media session on for the whole app. The graph itself cannot be
     wired yet — the media element only mounts once a track is armed (see the
     source effect), keeping `<Audio>` away from an empty src. */
  useEffect(() => {
    /* Expo Go: the OS session belongs to expo-audio; its mode call replaces
       the native AudioManager's three lines below. */
    if (goBackend) {
      void configureGoAudioMode();
      return () => {
        spatialCleanupRef.current();
      };
    }
    void engine?.AudioManager.setAudioSessionActivity(true).catch(() => undefined);
    engine?.AudioManager.observeAudioInterruptions(true);
    /* Android 13+ needs POST_NOTIFICATIONS before the foreground-service
       notification (the thing that keeps playback alive when the app is
       swiped away) can be shown. */
    void engine?.AudioManager.requestNotificationPermissions().catch(() => undefined);
    return () => {
      spatialCleanupRef.current();
    };
  }, []);

  /**
   * Native "background survival": a track paused without the user asking has
   * usually been taken (interruption, stall, reclaimed session). The retry
   * ladder mirrors the web's [150 … 9000] ms exactly.
   */
  const recoveryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const userPausedRef = useRef(false);
  /** A source swap pauses the element on its way through — not an interruption. */
  const swapUntilRef = useRef(0);
  const retryRef = useRef<() => void>(() => {});

  const clearRecovery = useCallback(() => {
    if (recoveryRef.current !== null) clearTimeout(recoveryRef.current);
    recoveryRef.current = null;
    attemptsRef.current = 0;
  }, []);

  /** play() on the native handle is fire-and-forget; failures arrive via
   *  onError / the pause watchdog, so "attempt" simply re-plays and waits. */
  useEffect(() => {
    const attempt = () => {
      recoveryRef.current = null;
      const handle = audioRef.current;
      if (!handle || !shouldPlayRef.current || userPausedRef.current) return;
      void context?.resume().catch(() => undefined);
      if (!pausedRef.current) {
        attemptsRef.current = 0;
        return;
      }
      handle.play();
      // The play result lands in onPlay / onError; schedule the next rung
      // and let the watchdog cancel it if the song takes back up.
      const wait = PLAYBACK_RETRY_AFTER[attemptsRef.current];
      attemptsRef.current += 1;
      if (wait === undefined) {
        attemptsRef.current = 0;
        shouldPlayRef.current = false;
        setPlaying(false);
        setPlayerError("Playback was interrupted — press play to continue.");
        return;
      }
      recoveryRef.current = setTimeout(attempt, wait);
    };
    retryRef.current = attempt;
    return () => {
      if (recoveryRef.current !== null) clearTimeout(recoveryRef.current);
      recoveryRef.current = null;
      retryRef.current = () => {};
    };
  }, [context]);

  const recoverPlayback = useCallback(() => {
    if (!shouldPlayRef.current || userPausedRef.current) return;
    if (recoveryRef.current !== null || Date.now() < swapUntilRef.current) return;
    attemptsRef.current = 1;
    recoveryRef.current = setTimeout(() => retryRef.current(), PLAYBACK_RETRY_AFTER[0]);
  }, []);

  /* Call/other-app interruption focus: when the system hands the audio
     session back, the interrupted track takes itself up — the media-focus
     twin of the web's visibility/statechange revives. */
  useEffect(() => {
    const interruption = onAudioInterruption((event) => {
      if (event.type === "ended" && event.shouldResume) recoverPlayback();
    });
    return interruption;
  }, [recoverPlayback]);

  const handlePause = useCallback(() => {
    pausedRef.current = true;
    setPlaying(false);
    if (endedRef.current) return; // the hand-off to the next track handles that pause
    if (shouldPlayRef.current && !userPausedRef.current) recoverPlayback();
  }, [recoverPlayback]);

  /* ── Background/foreground — replaces the web's visibility/pageshow/resume
        recovery pair with the native session equivalent. ── */
  const visibilityRef = useRef<AppStateStatus>("active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      visibilityRef.current = state;
      if (state === "active") {
        void context?.resume().catch(() => undefined);
        recoverPlayback();
      }
    });
    return () => sub.remove();
  }, [recoverPlayback, context]);

  /* Apply EQ changes live (gain moves only — no rewiring, no clicks). */
  useEffect(() => {
    eqGainsRef.current = eqGains;
    filtersRef.current.forEach((filter, filterIndex) => {
      filter.gain.setTargetAtTime(eqGains[filterIndex], filter.context.currentTime, 0.04);
    });
    const trim = eqTrimRef.current;
    if (trim)
      trim.gain.setTargetAtTime(eqMakeupGain(eqGains), trim.context.currentTime, 0.04);
    applyRouting();
  }, [eqGains, applyRouting]);

  /* Taste logging — what the listener did to the track that just ended and
     the one starting, one line per track. */
  const { record: recordTaste, vector: tasteVector } = useTaste();
  const tasteSongRef = useRef<Song | null>(null);
  const queueEndRef = useRef<(() => boolean) | null>(null);
  const pendingEndRef = useRef(false);
  const tastePositionRef = useRef(0);
  const tasteEndedRef = useRef(false);
  const tasteDoneRef = useRef(false);

  useEffect(() => {
    const previous = tasteSongRef.current;
    if (previous && previous.id !== current?.id && !tasteDoneRef.current) {
      const duration = previous.duration || 0;
      const pct = duration ? tastePositionRef.current / duration : 0;
      recordTaste(
        playbackKind(pct, tastePositionRef.current, tasteEndedRef.current),
        previous,
        { pct }
      );
    }
    tastePositionRef.current = 0;
    tasteEndedRef.current = false;
    tasteDoneRef.current = false;
    tasteSongRef.current = current ?? null;
    if (current) recordTaste("play", current, { pct: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  /**
   * Load a fresh stream whenever the active track changes. Native playback
   * always runs through the graph — no CORS probe or upgrade path — so the
   * loader is the web loader minus the cross-origin branch.
   */
  useEffect(() => {
    if (!current) return;
    let cancelled = false;

    /* The track-switch reset lands in the same commit — the web's loader
       effect did exactly this synchronously (progress back to 0 the instant
       the new song is current, before any position event can arrive). */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(0);
    positionRef.current = 0;
    setDuration(current.duration || 0);
    durationRef.current = current.duration || 0;
    setPlayerError(null);
    endedRef.current = false;
    streamFailuresRef.current = 0;
    currentRef.current = current;

    const arm = (target: string) => {
      // A source swap pauses the element on its way through.
      swapUntilRef.current = Date.now() + 1500;
      userPausedRef.current = false;
      endedRef.current = false;
      clearRecovery();
      readyRef.current = false;
      sourceRefForState.current = target;
      setSource(target);
    };

    const startStream = async () => {
      const refreshed = freshUrlRef.current;
      freshUrlRef.current = null;

      // A copy held on this device: a file:// URI — no handshake at all.
      if (current.offline) {
        const local = await openPlaybackUrl(current.offline.id);
        if (cancelled) return;
        if (!local) {
          setPlayerError("This saved copy is no longer on this device.");
          setPlaying(false);
          return;
        }
        setVisualizerReady(Boolean(engine));
        arm(local);
        return;
      }
      setVisualizerReady(Boolean(engine));
      arm(refreshed ?? current.streamUrl);
    };
    startStreamRef.current = startStream;

    void startStream();
    return () => {
      cancelled = true;
      if (startStreamRef.current === startStream) startStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  /* ── Expo Go transport ──
   * Without the native engine, the same armed source runs on expo-audio.
   * The handle drops into `audioRef`, so every command the provider issues —
   * play, pause, seek, volume, mute, tempo — reaches the player, and events
   * come back through the same handlers the `<Audio>` tag drives. The effect
   * that builds it lives below the handlers it reports to (see the tail of
   * this provider); only `goTransportRef` is needed here. */
  const goTransportRef = useRef<AudioTransport | null>(null);
  const goHandlersRef = useRef<AudioTransportCallbacks | null>(null);

  /* When a swapped-in source mounts/loads the element: wire the graph (the
     handle only exists now), apply the rate + envelope and play it if the
     listener wants it — the native answer to web's `arm()`. */
  const playPendingRef = useRef(false);
  useEffect(() => {
    if (!source) return;
    const handle = audioRef.current;
    if (!handle) return;
    // The graph is wired in onLoad — createMediaElementSource throws while
    // the tag has no loaded source, and a loaded element self-routes to the
    // output, so pre-load wiring attempts would only ever fail.
    handle.setPlaybackRate(rateRef.current);
    if (shouldPlayRef.current && !playPendingRef.current) {
      playPendingRef.current = true;
      // play() lands in onPlay/onWaiting; if the decoder is slow the
      // watchdog and the retry ladder take over from there.
      handle.play();
    }
  }, [source, ensureGraph]);

  /**
   * Re-resolves the active stream: a link that went stale mid-track gets a
   * fresh copy of the same recording by search. (CDN links expire; this is
   * why "plays a while then dies" never strands the listener.)
   */
  const refreshStream = useCallback(async (): Promise<boolean> => {
    const song = currentRef.current;
    if (!song || song.offline || refreshingRef.current) return false;
    refreshingRef.current = true;
    try {
      const result = await searchSongs(`${song.title} ${song.artist}`.trim(), 6, 1);
      const key = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
      const fresh =
        result.songs.find((candidate) => candidate.id === song.id && candidate.streamUrl) ??
        result.songs.find(
          (candidate) =>
            candidate.streamUrl &&
            key(candidate.title) === key(song.title) &&
            key(candidate.artist) === key(song.artist)
        );
      if (!fresh || fresh.streamUrl === song.streamUrl) return false;
      const url = fresh.streamUrl;
      freshUrlRef.current = url;
      setQueue((previous) =>
        previous.map((row) => (row.id === song.id ? { ...row, streamUrl: url } : row))
      );
      startStreamRef.current?.();
      return true;
    } catch {
      return false;
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  /** The stall watchdog — same cadence, same escalation as the web. */
  useEffect(() => {
    if (!playing) return;
    let lastAt = -1;
    let stalls = 0;
    const watch = setInterval(() => {
      const track = currentRef.current;
      if (!track || !shouldPlayRef.current || userPausedRef.current) return;
      if (Date.now() < swapUntilRef.current) return;
      if (pausedRef.current) {
        recoverPlayback();
        return;
      }
      const at = positionRef.current;
      if (at === lastAt) {
        stalls += 1;
        if (stalls >= 2) {
          stalls = 0;
          lastAt = -1;
          if (track.offline) return; // only the network copy can go stale
          streamFailuresRef.current += 1;
          if (streamFailuresRef.current >= 3) {
            streamFailuresRef.current = 0;
            void refreshStream();
          } else {
            startStreamRef.current?.();
          }
        }
      } else {
        stalls = 0;
        lastAt = at;
      }
    }, WATCHDOG_EVERY);
    return () => clearInterval(watch);
  }, [playing, recoverPlayback, refreshStream]);

  /* A queue that ran out while waiting for more tracks moves the moment they
   * arrive, so the listener hears one short beat instead of a stopped player. */
  useEffect(() => {
    if (!pendingEndRef.current || index + 1 >= queue.length) return;
    const frame = requestAnimationFrame(() => {
      if (!pendingEndRef.current) return;
      pendingEndRef.current = false;
      shouldPlayRef.current = true;
      setIndex(index + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [queue, index]);

  /** The paged surfaces register their own "give me the next page" here. */
  const setQueueEnd = useCallback((handler: (() => boolean) | null) => {
    queueEndRef.current = handler;
  }, []);

  // Volume/mute land on the graph's master gain — the single stage that
  // decides loudness.
  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
    const master = masterGainRef.current;
    const handle = audioRef.current;
    if (master) {
      master.gain.setTargetAtTime(
        masterLevel(volume, muted, preampDbRef.current),
        master.context.currentTime,
        0.03
      );
      if (handle) {
        handle.setVolume(1);
        handle.setMuted(false);
      }
    } else if (handle) {
      handle.setVolume(appliedVolume(volume));
      handle.setMuted(muted);
    }
  }, [volume, muted]);

  // Mixer head values ride along live — the nodes already sit in the path.
  useEffect(() => {
    preampDbRef.current = preampDb;
    const node = preampNodeRef.current;
    if (node)
      node.gain.setTargetAtTime(Math.pow(10, preampDb / 20), node.context.currentTime, 0.04);
    const master = masterGainRef.current;
    if (master) {
      master.gain.setTargetAtTime(
        masterLevel(volumeRef.current, mutedRef.current, preampDb),
        master.context.currentTime,
        0.03
      );
    }
  }, [preampDb]);

  useEffect(() => {
    balanceRef.current = balance;
    const node = panNodeRef.current;
    if (node) node.pan.setTargetAtTime(balance, node.context.currentTime, 0.04);
  }, [balance]);

  // Low-cut stage: 40 Hz engaged, 4 Hz bypassed.
  useEffect(() => {
    loCutRef.current = loCut;
    const node = loCutNodeRef.current;
    if (node)
      node.frequency.setTargetAtTime(loCut ? 40 : 4, node.context.currentTime, 0.05);
  }, [loCut]);

  // Tempo: pitch-true time stretch on the media element.
  useEffect(() => {
    rateRef.current = rate;
    const handle = audioRef.current;
    if (handle) handle.setPlaybackRate(rate);
  }, [rate]);

  /**
   * Time tick — progress state for the seek bar (throttled to the web's
   * ~4 Hz), listening telemetry, taste completion, the Auto DJ envelope,
   * and the lock-screen position report.
   */
  const notificationShownRef = useRef(false);
  const handlePosition = useCallback(
    (time: number) => {
      positionRef.current = time;
      const now = Date.now();
      if (now - lastProgressCommitRef.current < 240 && time > 0) {
        // still keep the cheap mirrors current
        tastePositionRef.current = time;
        return;
      }
      lastProgressCommitRef.current = now;
      setProgress(time);
      const track = currentRef.current;
      const dur = durationRef.current || track?.duration || 0;

      // Keep the OS session warm with a fresh position (setPositionState).
      if (track && dur && Number.isFinite(dur) && notificationShownRef.current) {
        void notify?.show({
          title: track.title,
          artist: track.artist,
          album: track.album || undefined,
          artwork: track.imageLarge ? { uri: track.imageLarge } : undefined,
          duration: dur,
          elapsedTime: Math.min(time, dur),
          speed: rateRef.current,
          state: shouldPlayRef.current && !pausedRef.current ? "playing" : "paused",
          skipInterval: 10,
        }).catch(() => undefined);
      }

      const playingTrack = tasteSongRef.current;
      tastePositionRef.current = time;
      if (
        playingTrack &&
        !tasteDoneRef.current &&
        playingTrack.duration &&
        time / playingTrack.duration >= 0.9
      ) {
        tasteDoneRef.current = true;
        recordTaste("complete", playingTrack, { pct: time / playingTrack.duration });
      }
      // Only count genuine forward plays; big jumps (seeks) don't count.
      const last = lastTickRef.current;
      if (time > last && time - last < 5) {
        setListenedSeconds((seconds) => seconds + (time - last));
      }
      lastTickRef.current = time;
      // Auto DJ hand-off: the master envelope glides down over the final
      // crossfade seconds, then rides back up through the next track's start.
      const djOut = djOutRef.current;
      if (djOut) {
        const fade = crossfadeRef.current;
        const wanted =
          dur && Number.isFinite(dur) && fade > 0 && dur - time < fade
            ? Math.max(0, (dur - time) / fade)
            : 1;
        djOut.gain.setTargetAtTime(wanted, djOut.context.currentTime, 0.1);
      }
    },
    [recordTaste]
  );

  /* ── OS media controls (the web's MediaSession, natively) ── */
  useEffect(() => {
    if (!current) {
      if (notificationShownRef.current) {
        void notify?.hide().catch(() => undefined);
        notificationShownRef.current = false;
      }
      return;
    }
    const info = {
      title: current.title,
      artist: current.artist,
      album: current.album || undefined,
      artwork: current.imageLarge ? { uri: current.imageLarge } : undefined,
      duration: durationRef.current || current.duration || undefined,
      elapsedTime: positionRef.current,
      state: playing ? ("playing" as const) : ("paused" as const),
      skipInterval: 10,
    };
    void notify?.show(info).then(() => {
      notificationShownRef.current = true;
    });
    void notify?.enableControl("nextTrack", true).catch(() => undefined);
    void notify?.enableControl("previousTrack", true).catch(() => undefined);
    void notify?.enableControl("seekTo", true).catch(() => undefined);
    void notify?.enableControl("skipForward", true).catch(() => undefined);
    void notify?.enableControl("skipBackward", true).catch(() => undefined);
    return () => {
      // Handlers live for the whole provider; metadata updates on change.
    };
  }, [current, playing]);

  // Transport buttons on the notification/lock screen.
  const transportRef = useRef<{
    togglePlay: () => void;
    stepTrack: (direction: 1 | -1) => void;
    stop: () => void;
    seek: (seconds: number) => void;
  } | null>(null);
  useEffect(() => {
    if (!notify) return;
    const subs = [
      notify.addEventListener("playbackNotificationPlay", () =>
        transportRef.current?.togglePlay()
      ),
      notify.addEventListener("playbackNotificationPause", () =>
        transportRef.current?.togglePlay()
      ),
      notify.addEventListener("playbackNotificationNextTrack", () =>
        transportRef.current?.stepTrack(1)
      ),
      notify.addEventListener("playbackNotificationPreviousTrack", () =>
        transportRef.current?.stepTrack(-1)
      ),
      notify.addEventListener("playbackNotificationStop", () =>
        transportRef.current?.stop()
      ),
      notify.addEventListener("playbackNotificationSkipBackward", (event) =>
        transportRef.current?.seek(Math.max(0, positionRef.current - (event.value ?? 10)))
      ),
      notify.addEventListener("playbackNotificationSkipForward", (event) =>
        transportRef.current?.seek(positionRef.current + (event.value ?? 10))
      ),
      notify.addEventListener("playbackNotificationSeekTo", (event) => {
        if (typeof event.value === "number") transportRef.current?.seek(event.value);
      }),
    ];
    return () => subs.forEach((sub) => sub?.remove());
  }, []);

  /* Release the audio graph when the provider unmounts (app teardown). */
  useEffect(
    () => () => {
      const handle = audioRef.current;
      if (handle) {
        handle.pause();
        handle.setVolume(0);
      }
      // Drop the lock-screen/foreground-service notification and hand the
      // OS audio session back, so no stale media notification outlives us.
      void notify?.hide().catch(() => undefined);
      void deactivateAudioSession();
      void context?.close().catch(() => undefined);
      releaseContext();
      analyserRef.current = null;
      mediaSourceRef.current = null;
    },
    [context]
  );

  const togglePlay = useCallback(() => {
    const handle = audioRef.current;
    if (!handle || !current || !source) return;
    if (pausedRef.current) {
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      endedRef.current = false;
      clearRecovery();
      void context?.resume().catch(() => undefined);
      handle.play();
    } else {
      userPausedRef.current = true;
      clearRecovery();
      handle.pause();
    }
  }, [clearRecovery, current, source, context]);

  const startQueue = useCallback(
    (list: Song[], label: string, position: number) => {
      // Playback always has a backend: the native graph when the engine is
      // linked, the expo-audio transport in Expo Go (goBackend === !engine).
      // Studio features degrade instead of gating the queue.
      /* A trial run is ten tracks long no matter which surface started it. */
      const run = isGuest ? list.slice(0, GUEST_PLAY_LIMIT) : list;
      const track = run[Math.min(position, run.length - 1)];
      if (!track) return;
      // Pressing the tile that is already active toggles playback.
      if (queue[index]?.id === track.id) {
        togglePlay();
        return;
      }
      shouldPlayRef.current = true;
      setQueue(run);
      setQueueLabel(label);
      setIndex(Math.min(position, run.length - 1));
      setSessionPlays((plays) => plays + 1);
      if (!panelShownRef.current) {
        panelShownRef.current = true;
        setNowPlayingOpenState(true);
      }
    },
    [queue, index, togglePlay, isGuest]
  );

  const setNowPlayingOpen = useCallback((open: boolean) => {
    setNowPlayingOpenState(open);
  }, []);

  /** Grow the running queue without disturbing what is playing. */
  const appendQueue = useCallback(
    (list: Song[]) => {
      if (isGuest || !list.length) return;
      setQueue((previous) => {
        const held = new Set(previous.map((song) => song.id));
        const fresh = list.filter((song) => !held.has(song.id));
        return fresh.length ? [...previous, ...fresh] : previous;
      });
    },
    [isGuest]
  );

  /* Auto recommendation feed: while playing, keep at least two tracks of the
   * listener's taste ready below the needle. */
  useEffect(() => {
    if (!autoFeed || !playing || !current) return;
    if (queue.length - (index + 1) > 2) return;
    if (autoFeedBusyRef.current) return;

    let alive = true;
    autoFeedBusyRef.current = true;
    const pool: FetchPool = async (phrase, limit) => {
      const found = await searchSongs(phrase, limit, 1);
      return found.songs;
    };
    buildRadioFor(current, tasteVector?.artistWords ?? new Set<string>(), pool, 8)
      .then((picks) => {
        if (alive) appendQueue(picks.map((pick) => pick.song));
      })
      .catch(() => {
        /* silence is the right fail — the next track change retries */
      })
      .finally(() => {
        autoFeedBusyRef.current = false;
      });
    return () => {
      alive = false;
    };
  }, [autoFeed, playing, current, queue, index, tasteVector?.artistWords, appendQueue]);

  const setPreampDb = useCallback((value: number) => {
    setPreampDbState(value);
  }, []);

  const setBalance = useCallback((value: number) => {
    setBalanceState(value);
  }, []);

  const setRate = useCallback((value: number) => {
    setRateState(value);
  }, []);

  const setSidebarWide = useCallback((wide: boolean) => {
    setSidebarWideState(wide);
  }, []);

  /** Live graph facts — the dashboard reads these on render. */
  const getGraphInfo = useCallback(() => {
    const ctx = context;
    return {
      webAudio: ctx !== null,
      sampleRate: ctx?.sampleRate ?? null,
      channels: ctx?.destination.channelCount ?? null,
    };
  }, [context]);

  /** Stereo RMS pair from the meter taps (0 → silence, ~1 → full swing). */
  const getLevels = useCallback((): [number, number] => {
    return metersRef.current.map((meter) => {
      if (!meter) return 0;
      const buffer = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      return Math.sqrt(sum / buffer.length);
    }) as [number, number];
  }, []);

  const setMixerOpen = useCallback((open: boolean) => {
    setMixerOpenState(open);
  }, []);

  const setLoCut = useCallback((on: boolean) => {
    setLoCutState(on);
  }, []);

  /* ── DJ transport ── */
  const cycleRepeat = useCallback(() => {
    setRepeatState((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleState((on) => !on);
  }, []);

  const toggleAutoFeed = useCallback(() => {
    setAutoFeedState((on) => {
      try {
        setItem(AUTO_FEED_KEY, on ? "0" : "1");
      } catch {
        /* storage off costs only the memory of the switch */
      }
      return !on;
    });
  }, []);

  const stop = useCallback(() => {
    const handle = audioRef.current;
    if (!handle) return;
    shouldPlayRef.current = false;
    userPausedRef.current = true;
    clearRecovery();
    handle.pause();
    handle.seekToTime(0);
    positionRef.current = 0;
    setProgress(0);
    if (djOutRef.current)
      djOutRef.current.gain.setTargetAtTime(1, djOutRef.current.context.currentTime, 0.02);
  }, [clearRecovery]);

  const endSession = useCallback(() => {
    stop();
    shouldPlayRef.current = false;
    setQueue([]);
    setQueueLabel("");
    setSource(null);
    sourceRefForState.current = null;
    setIndex(-1);
    setDuration(0);
    durationRef.current = 0;
    setProgress(0);
    setPlaying(false);
    setNowPlayingOpenState(false);
    setMixerOpenState(false);
  }, [stop]);

  const jumpTo = useCallback(
    (position: number) => {
      if (!queue[position]) return;
      shouldPlayRef.current = true;
      setIndex(position);
      setSessionPlays((plays) => plays + 1);
    },
    [queue]
  );

  const setCrossfade = useCallback((value: number) => {
    crossfadeRef.current = value;
    setCrossfadeState(value);
  }, []);

  /** One-tap party pad — synthesized straight on the audio context. */
  const playPad = useCallback((name: PadName) => {
    const ctx = context;
    if (!ctx) return;
    let bus = padBusRef.current;
    if (!bus) {
      bus = ctx.createGain();
      bus.gain.value = 0.9;
      bus.connect(ctx.destination);
      padBusRef.current = bus;
    }
    void ctx.resume().catch(() => undefined);
    firePad(ctx, bus, name);
  }, [context]);

  const setFx = useCallback((patch: Partial<FxLevels>) => {
    setFxState((levels) => ({ ...levels, ...patch }));
  }, []);

  const setSweep = useCallback((value: number) => {
    setSweepState(Math.min(1, Math.max(-1, Math.round(value * 100) / 100)));
  }, []);

  const setSubDb = useCallback((value: number) => {
    setSubDbState(value);
  }, []);

  const setCompAmt = useCallback((value: number) => {
    setCompAmtState(value);
  }, []);

  const setLimiterOn = useCallback((on: boolean) => {
    setLimiterOnState(on);
  }, []);

  const setLoudnessOn = useCallback((on: boolean) => {
    setLoudnessOnState(on);
  }, []);

  const stepTrack = useCallback(
    (direction: 1 | -1) => {
      if (index < 0) return;
      const handle = audioRef.current;
      // The first "previous" within the opening seconds restarts the track.
      if (direction === -1 && handle && positionRef.current > 3) {
        handle.seekToTime(0);
        positionRef.current = 0;
        setProgress(0);
        return;
      }
      const next = index + direction;
      if (next < 0) {
        handle?.seekToTime(0);
        return;
      }
      // Shuffle picks a random other track; advance wraps the queue.
      if (shuffle && queue.length > 1) {
        shouldPlayRef.current = true;
        let random = index;
        while (random === index) random = Math.floor(Math.random() * queue.length);
        setIndex(random);
        return;
      }
      /* A trial listener's run ends at the last song they were handed. */
      if (isGuest && next >= queue.length) {
        stop();
        requestLogin("playback");
        return;
      }
      shouldPlayRef.current = true;
      setIndex(next >= queue.length ? 0 : next);
    },
    [index, queue, shuffle, isGuest, requestLogin, stop]
  );

  /** Track end: repeat-one restarts in place; otherwise the queue advances. */
  const handleEnded = useCallback(() => {
    const handle = audioRef.current;
    if (!handle || !current) return;
    endedRef.current = true;
    pausedRef.current = true;
    const atEnd = index + 1 >= queue.length;
    tasteEndedRef.current = true;
    tastePositionRef.current = current.duration || durationRef.current || tastePositionRef.current;
    if (repeat === "one") {
      handle.seekToTime(0);
      handle.play();
      return;
    }
    if (shuffle && queue.length > 1) {
      let random = index;
      while (random === index) random = Math.floor(Math.random() * queue.length);
      shouldPlayRef.current = true;
      setIndex(random);
      return;
    }
    if (atEnd) {
      if (isGuest) {
        stop();
        requestLogin("playback");
        return;
      }
      const extended = queueEndRef.current?.() ?? false;
      if (extended) {
        pendingEndRef.current = true;
        return;
      }
      if (queue.length === 1) {
        handle.seekToTime(0);
        handle.play();
        return;
      }
    }
    shouldPlayRef.current = true;
    setIndex(atEnd ? 0 : index + 1);
  }, [current, repeat, shuffle, queue, index, isGuest, requestLogin, stop]);

  const seek = useCallback((seconds: number) => {
    const handle = audioRef.current;
    if (!handle) return;
    const dur = durationRef.current;
    const target = dur && Number.isFinite(dur) ? Math.max(0, Math.min(seconds, dur)) : Math.max(0, seconds);
    handle.seekToTime(target);
    positionRef.current = target;
    setProgress(target);
    if (djOutRef.current)
      djOutRef.current.gain.setTargetAtTime(1, djOutRef.current.context.currentTime, 0.02);
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    setMutedState(false);
  }, []);

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
  }, []);

  const applyPreset = useCallback((preset: EqPreset) => {
    setEqPreset(preset.label);
    setEqGains([...preset.gains]);
  }, []);

  const markEqCustom = useCallback((gains: number[]) => {
    setCustomEqGains([...gains]);
    setEqPreset("Custom");
  }, []);

  const applyCustomPreset = useCallback(() => {
    setEqPreset("Custom");
    setEqGains([...customEqGains]);
  }, [customEqGains]);

  const setEqGainsValue = useCallback((gains: number[]) => {
    setEqGains(gains);
  }, []);

  const setSpatialMode = useCallback(
    (mode: SpatialMode) => {
      spatialModeRef.current = mode;
      setSpatialModeState(mode);
      applySpatial();
      applyRouting();
    },
    [applySpatial, applyRouting]
  );

  /* Keep the transport mirror fresh for the notification event handlers. */
  useEffect(() => {
    transportRef.current = { togglePlay, stepTrack, stop, seek };
  }, [togglePlay, stepTrack, stop, seek]);

  /** Native element lifecycle — the same contract as the web handlers. */
  const handleLoad = useCallback(
    (loadedDuration: number) => {
      readyRef.current = true;
      playPendingRef.current = false;
      swapUntilRef.current = 0;
      if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
        durationRef.current = loadedDuration;
        setDuration(loadedDuration);
      }
      // First load of a mounted element wires the processing graph
      // (source → pre-amp → … → master → speakers + the analyser taps) —
      // the only moment createMediaElementSource is legal.
      if (!analyserRef.current) {
        const analyser = ensureGraph();
        setVisualizerReady(Boolean(analyser));
        if (analyser) {
          // The master gain owns loudness from here — lift the element back
          // to unity so only the fader curve moves the level, web parity.
          const handle = audioRef.current;
          handle?.setVolume(1);
          handle?.setMuted(false);
        }
      }
    },
    [ensureGraph]
  );

  const handleError = useCallback(
    (error: Error) => {
      void error;
      if (!current) return;
      if (current.offline) {
        shouldPlayRef.current = false;
        setPlayerError("This saved copy is no longer on this device.");
        setPlaying(false);
        return;
      }
      /* A stream error gets one silent re-arm under the recovery chain;
         failing twice in a row is a dead link, so the message shows. */
      streamFailuresRef.current += 1;
      if (streamFailuresRef.current <= 2 && shouldPlayRef.current && !userPausedRef.current) {
        setTimeout(() => {
          if (shouldPlayRef.current && !userPausedRef.current) startStreamRef.current?.();
        }, 1500);
        return;
      }
      shouldPlayRef.current = false;
      setPlayerError("This track could not be streamed — try another one.");
      setPlaying(false);
    },
    [current]
  );

  const handleAudioMeta = useCallback((metaDuration: number, ready: boolean) => {
    if (ready && metaDuration > 0 && (!durationRef.current || !Number.isFinite(durationRef.current))) {
      durationRef.current = metaDuration;
      setDuration(metaDuration);
    }
  }, []);

  /* ── Expo Go transport wiring ──
   * Declared here so the handlers above exist by the time this effect
   * references them. Only `source` recreates the player: the live handler
   * closures ride `goHandlersRef`, so a re-render never restarts the song. */
  useEffect(() => {
    goHandlersRef.current = {
      onLoad: (loadedDuration) => handleLoad(loadedDuration),
      onPlay: () => {
        pausedRef.current = false;
        userPausedRef.current = false;
        clearRecovery();
        attemptsRef.current = 0;
        setPlaying(true);
      },
      onPause: handlePause,
      onEnded: handleEnded,
      onError: handleError,
      onPositionChange: handlePosition,
    };
  });
  useEffect(() => {
    if (!goBackend) return;
    if (!source) {
      goTransportRef.current?.dispose();
      goTransportRef.current = null;
      return;
    }
    const transport = createGoAudioTransport(
      source,
      {
        onLoad: (loadedDuration) => goHandlersRef.current?.onLoad(loadedDuration),
        onPlay: () => goHandlersRef.current?.onPlay(),
        onPause: () => goHandlersRef.current?.onPause(),
        onEnded: () => goHandlersRef.current?.onEnded(),
        onError: (error) => goHandlersRef.current?.onError(error),
        onPositionChange: (time) => goHandlersRef.current?.onPositionChange(time),
      },
      {
        volume: appliedVolume(volumeRef.current),
        muted: mutedRef.current,
        rate: rateRef.current,
      }
    );
    goTransportRef.current = transport;
    audioRef.current = transport.handle;
    // The play intent (shouldPlayRef) was set by the loader effect — the
    // element's own effect ran earlier in this commit with no handle yet.
    if (shouldPlayRef.current && !playPendingRef.current) {
      playPendingRef.current = true;
      transport.handle.play();
    }
    return () => {
      if (goTransportRef.current === transport) {
        goTransportRef.current = null;
        audioRef.current = null;
      }
      transport.dispose();
    };
    // The transport is per-source by design; the live handlers ride the ref
    // above, so nothing else here may recreate the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goBackend, source]);
  useEffect(
    () => () => {
      goTransportRef.current?.dispose();
      goTransportRef.current = null;
    },
    []
  );

  const value = useMemo<MusicPlayerValue>(
    () => ({
      queue,
      queueLabel,
      index,
      current,
      playing,
      progress,
      duration,
      volume,
      muted,
      playerError,
      visualizerReady,
      nowPlayingOpen,
      setNowPlayingOpen,
      eqPreset,
      eqGains,
      getAnalyser,
      startQueue,
      appendQueue,
      setQueueEnd,
      togglePlay,
      stepTrack,
      seek,
      setVolume,
      setMuted,
      applyPreset,
      markEqCustom,
      applyCustomPreset,
      setEqGains: setEqGainsValue,
      spatialMode,
      setSpatialMode,
      preampDb,
      setPreampDb,
      balance,
      setBalance,
      rate,
      setRate,
      sidebarWide,
      setSidebarWide,
      listenedSeconds,
      sessionPlays,
      getGraphInfo,
      getLevels,
      loCut,
      setLoCut,
      repeat,
      cycleRepeat,
      shuffle,
      toggleShuffle,
      autoFeed,
      toggleAutoFeed,
      stop,
      endSession,
      jumpTo,
      crossfade,
      setCrossfade,
      fx,
      setFx,
      sweep,
      setSweep,
      subDb,
      setSubDb,
      compAmt,
      setCompAmt,
      limiterOn,
      setLimiterOn,
      loudnessOn,
      setLoudnessOn,
      playPad,
      mixerOpen,
      setMixerOpen,
      mobileNavOpen,
      setMobileNavOpen,
    }),
    [
      queue,
      queueLabel,
      index,
      current,
      playing,
      progress,
      duration,
      volume,
      muted,
      playerError,
      visualizerReady,
      nowPlayingOpen,
      setNowPlayingOpen,
      eqPreset,
      eqGains,
      getAnalyser,
      startQueue,
      appendQueue,
      setQueueEnd,
      togglePlay,
      stepTrack,
      seek,
      setVolume,
      setMuted,
      applyPreset,
      markEqCustom,
      applyCustomPreset,
      setEqGainsValue,
      spatialMode,
      setSpatialMode,
      preampDb,
      setPreampDb,
      balance,
      setBalance,
      rate,
      setRate,
      sidebarWide,
      setSidebarWide,
      listenedSeconds,
      sessionPlays,
      getGraphInfo,
      getLevels,
      loCut,
      setLoCut,
      repeat,
      cycleRepeat,
      shuffle,
      toggleShuffle,
      autoFeed,
      toggleAutoFeed,
      stop,
      endSession,
      jumpTo,
      crossfade,
      setCrossfade,
      fx,
      setFx,
      sweep,
      setSweep,
      subDb,
      setSubDb,
      compAmt,
      setCompAmt,
      limiterOn,
      setLimiterOn,
      loudnessOn,
      setLoudnessOn,
      playPad,
      mixerOpen,
      setMixerOpen,
      mobileNavOpen,
      setMobileNavOpen,
    ]
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {/* The app tree is a stable sibling — it never remounts with the media
          element. The singleton `<Audio>` mounts only while a track is armed
          (an empty src would make react-dom re-fetch the page on web and the
          native loader gains nothing from an idle element); its handle and
          the graph tap are re-attached together in the source effect. The
          meta bridge lives inside the tag so it can read duration/ready. */}
      {children}
      {AudioTagComponent && source ? (
        <AudioTagComponent
          ref={audioRef}
          source={source}
          context={context ?? undefined}
          preload="auto"
          autoPlay={false}
          loop={false}
          preservesPitch
          onPlay={() => {
            pausedRef.current = false;
            userPausedRef.current = false;
            clearRecovery();
            attemptsRef.current = 0;
            setPlaying(true);
          }}
          onPause={handlePause}
          onWaiting={recoverPlayback}
          onPlaying={recoverPlayback}
          onPositionChange={handlePosition}
          onLoad={() => {
            const track = currentRef.current;
            handleLoad(track?.duration || 0);
          }}
          onEnded={handleEnded}
          onError={handleError}
        >
          <AudioMetaBridge onMeta={handleAudioMeta} />
        </AudioTagComponent>
      ) : null}
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer(): MusicPlayerValue {
  const value = useContext(MusicPlayerContext);
  if (!value) throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  return value;
}
