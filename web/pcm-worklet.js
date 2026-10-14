// Continuously integrate input samples into 24 kHz bins, preserving phase across render quanta.
class PCM24 extends AudioWorkletProcessor {
  constructor(){super();this.ratio=sampleRate/24000;this.remaining=this.ratio;this.sum=0;this.frame=new ArrayBuffer(4800);this.view=new DataView(this.frame);this.count=0;}
  process(inputs,outputs){
    for(const output of outputs)for(const channel of output)channel.fill(0);
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let sample=0;for(const channel of channels)sample+=channel[i];sample/=channels.length;
      let available=1;
      while(available>1e-9){const take=Math.min(available,this.remaining);this.sum+=sample*take;this.remaining-=take;available-=take;
        if(this.remaining<1e-9){const value=Math.max(-1,Math.min(1,this.sum/this.ratio));this.view.setInt16(this.count*2,Math.round(value*(value<0?32768:32767)),true);this.count++;this.remaining=this.ratio;this.sum=0;
          if(this.count===2400){this.port.postMessage(this.frame,[this.frame]);this.frame=new ArrayBuffer(4800);this.view=new DataView(this.frame);this.count=0;}
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm24',PCM24);
