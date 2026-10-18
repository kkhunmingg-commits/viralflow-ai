import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import ffmpegPath from "ffmpeg-static";

type FilterProbe=(binary:string)=>string|null;
const probeFilters:FilterProbe=binary=>{const result=spawnSync(binary,["-hide_banner","-filters"],{windowsHide:true,encoding:"utf8",timeout:10_000});return result.status===0?result.stdout:null};
const hasDrawtext=(filters:string|null)=>Boolean(filters&&/^\s*\S+\s+drawtext\s/m.test(filters));

/** Overlay rendering needs drawtext. Some ffmpeg-static builds (Linux 7.0.2) omit it,
 * so prefer the first candidate that actually lists the filter. FFMPEG_BINARY is an
 * explicit operator choice and is used as-is. */
export function resolveFfmpegBinary(options:{env?:{FFMPEG_BINARY?:string};candidates?:Array<string|null>;probe?:FilterProbe}={}){
  const env=options.env??process.env;
  if(env.FFMPEG_BINARY)return env.FFMPEG_BINARY;
  const local=join(process.cwd(),"node_modules","ffmpeg-static",process.platform==="win32"?"ffmpeg.exe":"ffmpeg");
  const candidates=[...new Set((options.candidates??[existsSync(local)?local:null,ffmpegPath,"ffmpeg"]).filter((c):c is string=>Boolean(c)))];
  const probe=options.probe??probeFilters;
  const probed=candidates.map(binary=>({binary,filters:probe(binary)}));
  return probed.find(c=>hasDrawtext(c.filters))?.binary??probed.find(c=>c.filters!==null)?.binary??candidates[0]??null;
}
let cached:string|null|undefined;
export function ffmpegBinary(){if(cached===undefined)cached=resolveFfmpegBinary();return cached}
