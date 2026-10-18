import {join} from "node:path";
import type {ComposerAudioMode} from "./local-composer";
import type {ThaiVoiceLicense,ThaiVoiceProvider} from "./thai-voice";

export type NarrationSource=
  |{kind:"OWNER_VOICE";assetId:string}
  |{kind:"SYSTEM_TTS";provider:string;license:ThaiVoiceLicense;durationSeconds:number}
  |{kind:"CAPTION_ONLY";reason:string}
  |{kind:"NONE";reason:string};
export interface ResolvedNarration {voicePath?:string;audioMode:ComposerAudioMode;source:NarrationSource}

/** Picks narration without asking the owner: their own cleared recording first, then licensed
 * local Thai TTS, then a planned caption-only cut where the format allows it. Anything else
 * renders silent and fails quality, so a weak clip is never passed off as finished. */
export async function resolveNarration(input:{ownerVoice?:{assetId:string;path:string};script:string;workDir:string;
  tts:ThaiVoiceProvider|null;allowCaptionOnly:boolean;maxSeconds:number}):Promise<ResolvedNarration>{
  if(input.ownerVoice)return {voicePath:input.ownerVoice.path,audioMode:"NARRATION",source:{kind:"OWNER_VOICE",assetId:input.ownerVoice.assetId}};
  let ttsFailure:string|null=null;
  if(input.tts&&input.script.trim()){
    try{
      const voice=await input.tts.synthesize({text:input.script,outputPath:join(input.workDir,"narration.wav"),maxSeconds:input.maxSeconds});
      return {voicePath:voice.path,audioMode:"NARRATION",source:{kind:"SYSTEM_TTS",provider:input.tts.id,license:input.tts.license,durationSeconds:voice.durationSeconds}};
    }catch(error){ttsFailure=error instanceof Error?error.message:"thai_tts_failed"}
  }
  const reason=ttsFailure??(input.tts?"empty narration script":"no licensed Thai TTS configured on this renderer");
  if(input.allowCaptionOnly)return {audioMode:"CAPTION_ONLY",source:{kind:"CAPTION_ONLY",reason}};
  return {audioMode:"NARRATION",source:{kind:"NONE",reason}};
}
