import { liveKaraokeScript } from "./karaoke";
import { GO_SPACE_MODES, spatialProcessorScript, type GoSpaceMode } from "./go-spatial";
import type { AudioTransport, AudioTransportCallbacks, AudioTransportInitial } from "./go-audio";

export const EQ_PREVIEW_VERSION = 4;
export const EQ_PREVIEW_CHUNK = 48 * 1024;
export const EQ_PREVIEW_LIMIT = 25 * 1024 * 1024;
export type EqualizerCommand = { type: string; id: number; [key: string]: unknown };
type Host = {
  load: (id: number, source: string) => void;
  post: (command: EqualizerCommand) => void;
  cancel: () => void;
};

/** One owner for the WebView player. Late downloads/events cannot affect its replacement. */
export function createEqualizerBridge() {
  let host: Host | null = null;
  let serial = 0;
  let space: GoSpaceMode = "off";
  let karaoke = false;
  let gains = Array<number>(10).fill(0);
  let current: {
    id: number;
    source: string;
    callbacks: AudioTransportCallbacks;
    initial: AudioTransportInitial;
    playing: boolean;
    position: number;
    loaded: boolean;
  } | null = null;
  const send = (type: string, values: Record<string, unknown> = {}) => {
    if (current) host?.post({ type, id: current.id, ...values });
  };
  return {
    attach(next: Host) {
      host = next;
      if (current) {
        current.loaded = false;
        host.load(current.id, current.source);
      }
    },
    detach() {
      send("stop");
      host?.cancel();
      host = null;
    },
    setKaraoke(enabled: boolean) {
      karaoke = enabled;
      send("karaoke", { enabled });
    },
    setSpace(mode: GoSpaceMode) {
      space = GO_SPACE_MODES.includes(mode) ? mode : "off";
      send("space", { mode: space });
    },
    setGains(values: number[]) {
      gains = Array.from({ length: 10 }, (_, i) =>
        Number.isFinite(values[i]) ? Math.max(-12, Math.min(12, values[i])) : 0
      );
      send("eq", { gains });
    },
    begin(id: number) {
      if (current?.id !== id) return false;
      send("begin", {
        ...current.initial,
        gains,
        space,
        karaoke,
        playing: current.playing,
        position: current.position,
      });
      return true;
    },
    receive(message: {
      id?: number;
      type: string;
      duration?: number;
      time?: number;
      value?: boolean;
      message?: string;
    }) {
      const item = current;
      if (!item || item.id !== message.id) return;
      switch (message.type) {
        case "loaded":
          if (!item.loaded && Number.isFinite(message.duration) && message.duration! > 0) {
            item.loaded = true;
            item.callbacks.onLoad(message.duration!);
          }
          break;
        case "play":
          item.playing = true;
          item.callbacks.onPlay();
          break;
        case "pause":
          item.playing = false;
          item.callbacks.onPause();
          break;
        case "ended":
          item.playing = false;
          item.callbacks.onPause();
          item.callbacks.onEnded();
          break;
        case "position":
          if (Number.isFinite(message.time)) {
            item.position = message.time!;
            item.callbacks.onPositionChange(message.time!);
          }
          break;
        case "buffering":
          item.callbacks.onBufferingChange?.(!!message.value);
          break;
        case "error":
          item.callbacks.onError(
            new Error(message.message || "EQ preview could not play this track.")
          );
          break;
      }
    },
    createTransport(
      source: string,
      callbacks: AudioTransportCallbacks,
      initial: AudioTransportInitial
    ): AudioTransport {
      if (current) {
        send("stop");
        host?.cancel();
      }
      const item = {
        id: ++serial,
        source,
        callbacks,
        initial: { ...initial },
        playing: false,
        position: 0,
        loaded: false,
      };
      current = item;
      host?.load(item.id, source);
      const active = () => current === item;
      return {
        handle: {
          play() {
            if (active()) {
              item.playing = true;
              send("play");
            }
          },
          pause() {
            if (active()) {
              item.playing = false;
              send("pause");
            }
          },
          seekToTime(time) {
            if (active() && Number.isFinite(time)) {
              item.position = Math.max(0, time);
              send("seek", { position: item.position });
            }
          },
          setVolume(volume) {
            if (active() && Number.isFinite(volume)) {
              item.initial.volume = Math.max(0, Math.min(1, volume));
              send("volume", { volume: item.initial.volume });
            }
          },
          setMuted(muted) {
            if (active()) {
              item.initial.muted = muted;
              send("mute", { muted });
            }
          },
          setPlaybackRate(rate) {
            if (active() && Number.isFinite(rate)) {
              item.initial.rate = Math.max(0.1, Math.min(2, rate));
              send("rate", { rate: item.initial.rate });
            }
          },
        },
        dispose() {
          if (active()) {
            send("stop");
            current = null;
            host?.cancel();
          }
        },
      };
    },
  };
}
export type EqualizerBridge = ReturnType<typeof createEqualizerBridge>;

/** Real streaming media -> ten peaking filters -> compensated gain -> speakers. */
export function equalizerPreviewHtml(): string {
  return `<!doctype html><html><meta name="viewport" content="width=device-width"><body><script>
(function(){
  var context, audio, filters, trim, output, karaoke, space, spaceIn, spaceOut, id=0, chunks=[], bytes=0, next=0, url=null, loadTimer=null, wantsPlay=false, loaded=false, position=0, volume=1, muted=false;
  ${spatialProcessorScript()}
  ${liveKaraokeScript()}
  var frequencies=[31,62,125,250,500,1000,2000,4000,8000,16000];
  function post(type, values) { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type,id:id},values||{}))); }
  function fail(error) { clearTimeout(loadTimer);loadTimer=null;if(audio){audio.onpause=null;audio.pause();} wantsPlay=false;loaded=false;if(output)output.gain.value=0;post('error',{message:error && error.message || String(error)}); }
  function smooth(param,value) { param.setTargetAtTime(value,context.currentTime,0.02); }
  function eq(gains) {
    var curve=frequencies.map(function(_,i){return Number.isFinite(gains[i])?Math.max(-12,Math.min(12,gains[i])):0;});
    filters.forEach(function(filter,i){smooth(filter.gain,curve[i]);});
    var rms=Math.sqrt(curve.reduce(function(sum,g){return sum+g*g;},0)/10);
    smooth(trim.gain,Math.pow(10,-(Math.max.apply(null,[0].concat(curve))+rms)/40));
  }
  function gain() { smooth(output.gain,muted?0:volume); }
  function stop() {
    clearTimeout(loadTimer);loadTimer=null;
    if(space)space.setMode('off');
    wantsPlay=false; loaded=false; audio.onpause=null; audio.pause(); audio.removeAttribute('src'); audio.load();
    if(url) URL.revokeObjectURL(url); url=null; chunks=[]; bytes=0; next=0;
  }
  function openMedia(source, timeout) {
    var owner=id;
    // anonymous CORS is essential: without it a cross-origin Web Audio
    // source can play silently instead of reporting an error.
    audio.crossOrigin='anonymous';
    audio.onpause=function(){if(owner===id&&loaded&&!audio.ended)post('pause');};
    audio.oncanplay=function(){if(owner!==id)return;clearTimeout(loadTimer);loadTimer=null;play();};
    loadTimer=setTimeout(function(){if(id===owner)fail(new Error('The effects stream did not become ready.'));},timeout);
    audio.src=source;audio.load();
  }
  function play() {
    if(!loaded || !wantsPlay) return;
    var owner=id;
    context.resume().then(function(){if(owner===id && wantsPlay) return audio.play();}).catch(function(error){if(owner===id && wantsPlay) fail(error);});
  }
  try {
    var Context=window.AudioContext||window.webkitAudioContext;
    if(!Context) throw new Error('This device WebView does not support EQ. Update Android System WebView and retry.');
    context=new Context(); audio=document.createElement('audio'); audio.preload='auto'; audio.playsInline=true; document.body.appendChild(audio);
    filters=frequencies.map(function(hz){var f=context.createBiquadFilter();f.type='peaking';f.frequency.value=hz;f.Q.value=1;return f;});
    trim=context.createGain();output=context.createGain();
    var source=context.createMediaElementSource(audio);source.connect(filters[0]);
    filters.forEach(function(f,i){f.connect(filters[i+1]||trim);});spaceIn=context.createGain();spaceOut=context.createGain();karaoke=createLiveKaraokeStage(context);trim.connect(karaoke.input);karaoke.output.connect(spaceIn);space=createSpaceProcessor(context,spaceIn,spaceOut);spaceOut.connect(output);output.connect(context.destination);
    audio.onloadedmetadata=function(){if(!Number.isFinite(audio.duration)||audio.duration<=0)return;loaded=true;if(position>0)audio.currentTime=Math.min(position,audio.duration);post('loaded',{duration:audio.duration});post('buffering',{value:false});play();};
    audio.onplaying=function(){clearTimeout(loadTimer);loadTimer=null;post('buffering',{value:false});post('play');};
    audio.onwaiting=function(){post('buffering',{value:true});};
    audio.onended=function(){wantsPlay=false;post('ended');};
    audio.onerror=function(){if(id&&audio.error)fail(new Error('EQ could not decode this track. Original playback restored.'));};
    setInterval(function(){if(loaded&&!audio.paused)post('position',{time:audio.currentTime});},250);
    window.zyravaEqCommand=function(command){
      try {
        if(command.type==='begin') {
          stop(); id=command.id; volume=command.volume;muted=command.muted;position=command.position||0;wantsPlay=command.playing;
          audio.playbackRate=command.rate;audio.preservesPitch=true;eq(command.gains);karaoke.setEnabled(!!command.karaoke);space.setMode(command.space||'off');gain();return;
        }
        if(command.id!==id)return;
        switch(command.type){
          case 'stream':
            if(!/^https?:\\/\\//i.test(command.source))throw new Error('Unsupported stream URL.');
            openMedia(command.source,8000);break;
          case 'chunk':
            if(command.index!==next)throw new Error('EQ audio transfer was interrupted.');
            var binary=atob(command.data), chunk=new Uint8Array(binary.length);
            for(var i=0;i<binary.length;i++)chunk[i]=binary.charCodeAt(i);
            bytes+=chunk.length;if(bytes>${EQ_PREVIEW_LIMIT})throw new Error('EQ preview supports tracks up to 25 MB.');
            chunks.push(chunk);next++;post('ack',{index:command.index});break;
          case 'finish':
            if(bytes!==command.bytes||next!==command.chunks)throw new Error('Incomplete EQ audio transfer.');
            url=URL.createObjectURL(new Blob(chunks,{type:command.mime||'audio/mpeg'}));chunks=[];
            openMedia(url,30000);break;
          case 'eq':eq(command.gains);break;
          case 'space':space.setMode(command.mode);break;
          case 'karaoke':karaoke.setEnabled(!!command.enabled);break;
          case 'volume':volume=command.volume;gain();break;
          case 'mute':muted=command.muted;gain();break;
          case 'rate':audio.playbackRate=command.rate;break;
          case 'seek':position=command.position;if(loaded){audio.currentTime=Math.min(position,audio.duration);post('position',{time:audio.currentTime});}break;
          case 'play':wantsPlay=true;play();break;
          case 'pause':wantsPlay=false;audio.pause();break;
          case 'stop':stop();id=0;break;
        }
      }catch(error){fail(error);}
    };
    post('ready',{version:${EQ_PREVIEW_VERSION}});
  }catch(error){fail(error);}
})();</script></body></html>`;
}
