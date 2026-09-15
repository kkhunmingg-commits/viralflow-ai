import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {VIDEO_HEIGHT,VIDEO_WIDTH,type ImageProvider,type VideoProvider,type VideoRenderInput,type VoiceProvider} from "./types";

export class MockVideoProvider implements VideoProvider {
  readonly provider:string="mock-video";
  readonly model:string="deterministic-video-v1";
  async plan(input:VideoRenderInput){return structuredClone(input)}
}
export class TemplateVideoProvider extends MockVideoProvider {
  override readonly provider="template-video";
  override readonly model="commerce-template-v1";
}
export class LowCostImageToVideoProvider extends MockVideoProvider {override readonly provider="reserved-low-cost";override async plan():Promise<VideoRenderInput>{throw new Error("Paid image-to-video provider is not enabled")}}
export class TikTokSymphonyProvider extends MockVideoProvider {override readonly provider="reserved-tiktok-symphony";override async plan():Promise<VideoRenderInput>{throw new Error("TikTok Symphony is not connected")}}
export class PremiumVideoProvider extends MockVideoProvider {override readonly provider="reserved-premium";override async plan():Promise<VideoRenderInput>{throw new Error("Premium video provider requires explicit approval")}}

export class MockImageProvider implements ImageProvider {
  readonly provider="mock-image";
  readonly model="ppm-product-card-v1";
  async createProductImage(title:string,outputPath:string){
    const width=VIDEO_WIDTH,height=VIDEO_HEIGHT,header=Buffer.from(`P6\n${width} ${height}\n255\n`),pixels=Buffer.alloc(width*height*3);
    const hue=createHash("sha256").update(title).digest()[0]??80;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*3,center=Math.abs(x-width/2)/(width/2),vertical=y/height;
      const card=x>width*.18&&x<width*.82&&y>height*.2&&y<height*.72;
      pixels[i]=card?230:Math.round(20+hue*.2+vertical*25);
      pixels[i+1]=card?235:Math.round(35+(255-hue)*.22+center*18);
      pixels[i+2]=card?242:Math.round(70+hue*.25+(1-vertical)*25);
    }
    const bytes=Buffer.concat([header,pixels]);await writeFile(outputPath,bytes);
    return {path:outputPath,checksum:createHash("sha256").update(bytes).digest("hex"),width,height};
  }
}
export class MockVoiceProvider implements VoiceProvider {
  readonly provider="mock-voice";
  readonly model="generated-tone-v1";
  async createVoiceTrack(text:string,outputPath:string,durationSeconds:number){
    const rate=16000,samples=Math.round(rate*durationSeconds),data=Buffer.alloc(samples*2),seed=(createHash("sha256").update(text).digest()[0]??0)%80;
    for(let i=0;i<samples;i++){const active=i%(rate*.8)<rate*.34,fade=Math.min(1,i/(rate*.04),(samples-i)/(rate*.08));const value=active?Math.sin(2*Math.PI*(190+seed)*i/rate)*.09*fade:0;data.writeInt16LE(Math.round(value*32767),i*2)}
    const header=Buffer.alloc(44);header.write("RIFF",0);header.writeUInt32LE(36+data.length,4);header.write("WAVEfmt ",8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write("data",36);header.writeUInt32LE(data.length,40);
    await writeFile(outputPath,Buffer.concat([header,data]));return {path:outputPath,duration:durationSeconds};
  }
}
