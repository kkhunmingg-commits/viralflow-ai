import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {rename} from "node:fs/promises";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";

/** Provenance stored with every synthesized narration so the output can be audited later. */
export interface ThaiVoiceLicense {engine:string;engineLicense:string;modelId:string;modelLicense:string;
  voice:"DESIGNED_NO_REFERENCE";commercialUse:true;aiGenerated:true;checkedAt:string;sources:string[]}
export interface ThaiVoiceProvider {id:string;license:ThaiVoiceLicense;
  synthesize(input:{text:string;outputPath:string;maxSeconds:number}):Promise<{path:string;durationSeconds:number}>}

// Checked 2026-10-18 against the model card and PyPI metadata. Voice design uses a text description,
// never a reference recording, so no real person's voice is cloned.
export const VOXCPM2_LICENSE:ThaiVoiceLicense={engine:"voxcpm",engineLicense:"Apache-2.0",modelId:"openbmb/VoxCPM2",modelLicense:"Apache-2.0",
  voice:"DESIGNED_NO_REFERENCE",commercialUse:true,aiGenerated:true,checkedAt:"2026-10-18",
  sources:["https://huggingface.co/openbmb/VoxCPM2","https://pypi.org/project/voxcpm/","https://github.com/OpenBMB/VoxCPM"]};
export const DEFAULT_THAI_VOICE_DESCRIPTION="A warm, clear Thai female narrator in her late twenties, friendly and natural, medium pace";

/** Runs a local TTS command (scripts/thai-tts/voxcpm2_tts.py by default). The command receives
 * JSON on stdin and writes a WAV; nothing is sent to a paid or remote service. */
export class LocalCommandThaiVoice implements ThaiVoiceProvider{
  readonly id="voxcpm2-local";
  readonly license=VOXCPM2_LICENSE;
  constructor(private readonly command:string[],private readonly voiceDescription=DEFAULT_THAI_VOICE_DESCRIPTION,private readonly timeoutMs=600_000){
    if(!command.length)throw new Error("thai_tts_not_configured");
  }
  async synthesize(input:{text:string;outputPath:string;maxSeconds:number}){
    const text=input.text.normalize("NFC").replace(/\s+/g," ").trim();
    if(!text||text.length>400)throw new Error("thai_tts_text_invalid");
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(this.command[0],this.command.slice(1),{windowsHide:true,stdio:["pipe","ignore","pipe"]}),errors:Buffer[]=[];
      let failed:Error|null=null;
      const timer=setTimeout(()=>{failed=new Error("thai_tts_timeout");child.kill()},this.timeoutMs);
      child.stderr.on("data",d=>errors.push(Buffer.from(d)));
      child.on("error",error=>{failed=error});
      child.on("close",code=>{clearTimeout(timer);if(failed||code!==0)reject(failed??new Error(`thai_tts_failed: ${Buffer.concat(errors).toString().slice(-400)}`));else resolve()});
      child.stdin.end(JSON.stringify({text,voice:this.voiceDescription,output:input.outputPath}));
    });
    const media=await new FFmpegVideoRenderer().probe(input.outputPath);
    if(!media.hasAudio||!(media.duration>.5))throw new Error("thai_tts_output_invalid");
    if(media.duration<=input.maxSeconds)return {path:input.outputPath,durationSeconds:media.duration};
    // Narration longer than the clip would be cut mid-sentence. A slight overrun is sped up, which keeps
    // pitch and stays natural up to about 12%; anything longer means the script must be shortened.
    if(media.duration>input.maxSeconds*MAX_TEMPO)throw new Error("thai_tts_too_long");
    const fitted=`${input.outputPath}.fit.wav`;
    const ffmpeg=ffmpegBinary();if(!ffmpeg)throw new Error("thai_tts_too_long");
    await run(ffmpeg,["-loglevel","error","-y","-i",input.outputPath,"-filter:a",`atempo=${(media.duration/(input.maxSeconds*.98)).toFixed(4)}`,fitted]);
    await rename(fitted,input.outputPath);
    const sped=await new FFmpegVideoRenderer().probe(input.outputPath);
    if(!(sped.duration<=input.maxSeconds))throw new Error("thai_tts_too_long");
    return {path:input.outputPath,durationSeconds:sped.duration};
  }
}

const MAX_TEMPO=1.12;
function run(command:string,args:string[]){
  return new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:"ignore"});
    child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error("thai_tts_fit_failed")))});
}

/** THAI_TTS_PROVIDER=voxcpm2 with THAI_TTS_PYTHON pointing at an environment where voxcpm is installed. */
export function configuredThaiVoice(env:{THAI_TTS_PROVIDER?:string;THAI_TTS_PYTHON?:string;THAI_TTS_SCRIPT?:string;THAI_TTS_VOICE?:string}=process.env as Record<string,string|undefined>):ThaiVoiceProvider|null{
  if(env.THAI_TTS_PROVIDER!=="voxcpm2"||!env.THAI_TTS_PYTHON)return null;
  const script=env.THAI_TTS_SCRIPT??`${process.cwd()}/scripts/thai-tts/voxcpm2_tts.py`;
  if(!existsSync(script))return null;
  return new LocalCommandThaiVoice([env.THAI_TTS_PYTHON,script],env.THAI_TTS_VOICE?.trim()||DEFAULT_THAI_VOICE_DESCRIPTION);
}
