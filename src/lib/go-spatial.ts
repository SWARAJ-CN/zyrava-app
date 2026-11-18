/** Space modes supported by both the installed graph and Expo Go's Web Audio host. */
export const GO_SPACE_MODES = [
  "off",
  "stereo",
  "mono",
  "wide",
  "8d",
  "3d",
  "surround",
  "stack",
  "pan",
  "telephone",
  "echo",
] as const;
export type GoSpaceMode = (typeof GO_SPACE_MODES)[number];

/** Runs inside the isolated WebView; values match the web player's Space graph.
 * Every mode owns its nodes. Replacing it disconnects feedback and stops LFOs,
 * so neither delayed tails nor parallel dry paths accumulate between selections.
 */
export function spatialProcessorScript(): string {
  return `function createSpaceProcessor(ctx,input,output) {
    var allocated=[], oscillators=[], mode=null;
    function track(node){allocated.push(node);return node;}
    function gain(value){var node=track(ctx.createGain());node.gain.value=value;return node;}
    function clear(){
      input.disconnect();
      oscillators.forEach(function(node){try{node.stop();}catch(_){}});
      allocated.forEach(function(node){try{node.disconnect();}catch(_){}});
      allocated=[];oscillators=[];
    }
    function orbit(rate,depthValue,threeD){
      var panner=track(threeD?ctx.createPanner():ctx.createStereoPanner());
      if(threeD){panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=0.5;panner.rolloffFactor=0.4;panner.positionZ.value=-0.9;panner.positionY.value=-0.1;}
      var lfo=track(ctx.createOscillator()),depth=gain(depthValue);
      lfo.type='sine';lfo.frequency.value=rate;lfo.connect(depth);depth.connect(threeD?panner.positionX:panner.pan);
      input.connect(panner);panner.connect(output);oscillators.push(lfo);lfo.start();
    }
    function setMode(next,force){
      if(mode===next&&!force)return;
      clear();mode=next;
      try {
        if(next==='off'||next==='stereo'){input.connect(output);return;}
        if(next==='8d'){orbit(0.08,0.95,false);return;}
        if(next==='pan'){orbit(0.45,0.7,false);return;}
        if(next==='3d'){orbit(0.05,1.8,true);return;}
        if(next==='telephone'){
          var band=track(ctx.createBiquadFilter()),level=gain(1.6);
          band.type='bandpass';band.frequency.value=1400;band.Q.value=1.1;
          input.connect(band);band.connect(level);level.connect(output);return;
        }
        if(next==='echo'){
          var dry=gain(0.85),delay=track(ctx.createDelay(1.2)),damp=track(ctx.createBiquadFilter()),feedback=gain(0.38),wet=gain(0.5);
          delay.delayTime.value=0.32;damp.type='lowpass';damp.frequency.value=3200;
          input.connect(dry);dry.connect(output);input.connect(delay);delay.connect(damp);
          damp.connect(feedback);feedback.connect(delay);damp.connect(wet);wet.connect(output);return;
        }
        var split=track(ctx.createChannelSplitter(2));input.connect(split);
        if(next==='mono'){
          var left=gain(0.5),right=gain(0.5),sum=gain(1);
          split.connect(left,0);split.connect(right,1);left.connect(sum);right.connect(sum);sum.connect(output);return;
        }
        var merge=track(ctx.createChannelMerger(2));merge.connect(output);
        if(next==='wide'){
          var straightL=gain(0.85),straightR=gain(0.85),crossL=gain(-0.45),crossR=gain(-0.45);
          split.connect(straightL,0);split.connect(crossR,0);split.connect(straightR,1);split.connect(crossL,1);
          straightL.connect(merge,0,0);crossL.connect(merge,0,0);crossR.connect(merge,0,1);straightR.connect(merge,0,1);return;
        }
        if(next==='stack'){
          var subL=gain(0.5),subR=gain(0.5),sub=gain(1),low=track(ctx.createBiquadFilter()),topL=gain(0.95),topR=gain(0.95);
          low.type='lowpass';low.frequency.value=130;low.Q.value=0.7;
          split.connect(subL,0);split.connect(subR,1);subL.connect(sub);subR.connect(sub);sub.connect(low);
          low.connect(merge,0,0);low.connect(merge,0,1);split.connect(topL,0);split.connect(topR,1);topL.connect(merge,0,0);topR.connect(merge,0,1);return;
        }
        var toRight=track(ctx.createDelay(0.05)),toLeft=track(ctx.createDelay(0.05)),bleedRight=gain(0.32),bleedLeft=gain(0.32);
        toRight.delayTime.value=0.018;toLeft.delayTime.value=0.018;
        split.connect(merge,0,0);split.connect(merge,1,1);
        split.connect(toRight,0);toRight.connect(bleedRight);bleedRight.connect(merge,0,1);
        split.connect(toLeft,1);toLeft.connect(bleedLeft);bleedLeft.connect(merge,0,0);
      }catch(error){clear();mode='off';input.connect(output);throw error;}
    }
    setMode('off');
    return {setMode:setMode,reset:function(){setMode(mode,true);},dispose:clear};
  }`;
}
