import {describe,expect,it,vi} from "vitest";
import {resolveNarration} from "./narration";
import {VOXCPM2_LICENSE,type ThaiVoiceProvider} from "./thai-voice";

const tts=(impl:ThaiVoiceProvider["synthesize"]):ThaiVoiceProvider=>({id:"fake-tts",license:VOXCPM2_LICENSE,synthesize:vi.fn(impl)});
const base={script:"สวัสดี",workDir:"/work",maxSeconds:7.8};

describe("automatic narration choice",()=>{
  it("prefers the owner's cleared recording and never synthesises over it",async()=>{
    const provider=tts(async()=>({path:"x",durationSeconds:3}));
    const result=await resolveNarration({...base,ownerVoice:{assetId:"v1",path:"/work/voice"},tts:provider,allowCaptionOnly:false});
    expect(result).toEqual({voicePath:"/work/voice",audioMode:"NARRATION",source:{kind:"OWNER_VOICE",assetId:"v1"}});
    expect(provider.synthesize).not.toHaveBeenCalled();
  });
  it("falls back to licensed TTS with its licence attached",async()=>{
    const result=await resolveNarration({...base,tts:tts(async i=>({path:i.outputPath,durationSeconds:4.2})),allowCaptionOnly:false});
    expect(result.voicePath).toBe("/work/narration.wav");
    expect(result.source).toMatchObject({kind:"SYSTEM_TTS",provider:"fake-tts",durationSeconds:4.2,license:{commercialUse:true}});
  });
  it("goes caption-only only where the format allows it, keeping the TTS failure reason",async()=>{
    const failing=tts(async()=>{throw new Error("thai_tts_too_long")});
    expect(await resolveNarration({...base,tts:failing,allowCaptionOnly:true})).toEqual({audioMode:"CAPTION_ONLY",source:{kind:"CAPTION_ONLY",reason:"thai_tts_too_long"}});
    // A product ad without narration stays in NARRATION mode with no voice, so the VOICE check fails it.
    expect(await resolveNarration({...base,tts:failing,allowCaptionOnly:false})).toEqual({audioMode:"NARRATION",source:{kind:"NONE",reason:"thai_tts_too_long"}});
    expect((await resolveNarration({...base,tts:null,allowCaptionOnly:false})).source).toMatchObject({kind:"NONE",reason:expect.stringContaining("no licensed Thai TTS")});
  });
});
