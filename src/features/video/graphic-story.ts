import {createHash} from "node:crypto";
import {graphicCardCopy,graphicCardFits} from "../creative/strategist";
import {composeRealMedia,type ComposerClip} from "./local-composer";
import {resolveNarration} from "./narration";
import type {ThaiVoiceProvider} from "./thai-voice";

// Dark, high-contrast pairs so white Thai text stays legible on every frame.
const PALETTES:Array<[string,string]>=[["0x1E3A5F","0x0F766E"],["0x3B0764","0x9D174D"],["0x172554","0x7C2D12"],["0x14532D","0x1E3A8A"]];

export interface GraphicStoryboard {cards:Array<{headline:string;palette:[string,string]}>}

/** Three cards: hook, the one verified point, call to action. Copy that cannot fit a card is
 * rejected rather than shrunk, so the plan gets shortened instead of shipping unreadable text. */
export function buildGraphicStoryboard(input:{seed:string;hook:string;script:string;cta:string}):GraphicStoryboard{
  const headlines=graphicCardCopy(input.hook,input.script,input.cta);
  if(headlines.some(h=>!h))throw new Error("GRAPHIC_STORY_COPY_MISSING");
  if(!headlines.every(graphicCardFits))throw new Error("GRAPHIC_CARD_TOO_LONG");
  const palette=PALETTES[createHash("sha256").update(input.seed).digest()[0]%PALETTES.length];
  return {cards:headlines.map((headline,i)=>({headline,palette:i===1?[palette[1],palette[0]]:palette}))};
}

export async function renderGraphicStoryMaster(input:{storyboard:GraphicStoryboard;script:string;tts:ThaiVoiceProvider|null;
  ownerVoice?:{assetId:string;path:string};workDir:string;outputPath:string}){
  // The cards carry the full message, so a caption-only cut is a legitimate plan here if it is readable.
  const narration=await resolveNarration({ownerVoice:input.ownerVoice,script:input.script,workDir:input.workDir,tts:input.tts,allowCaptionOnly:true,maxSeconds:7.8});
  const clips:ComposerClip[]=input.storyboard.cards.map((card,i)=>({assetId:`graphic-${i+1}`,path:"",kind:"GRAPHIC",headline:card.headline,palette:card.palette}));
  const composed=await composeRealMedia({clips,captions:[],voicePath:narration.voicePath,audioMode:narration.audioMode,durationSeconds:8,workDir:input.workDir,outputPath:input.outputPath});
  return {...composed,narration:narration.source};
}
