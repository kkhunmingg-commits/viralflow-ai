/* Assembles the real-product ad from AI-generated shots, Thai narration (VoxCPM2, local) and Thai captions,
 * reusing the composer's ffmpeg graph, caption styles and loudness handling. Nothing is posted.
 * Usage: node --import tsx scripts/product-video/assemble.ts <plan.json> <shots-dir> <out-dir> */
import {spawn} from "node:child_process";
import {copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {ffmpegBinary} from "../../src/features/video/ffmpeg-binary";
import {FFmpegVideoRenderer} from "../../src/features/video/renderer";
import {LocalCommandThaiVoice} from "../../src/features/video/thai-voice";
import {THAI_FONT_FILE,buildAssSubtitles,composerArgs,composerQc,defaultThaiFontPath,measureLoudness,shotOverlays,voiceGainDb,
  VOICE_COMPRESSOR,type ComposerClip} from "../../src/features/video/local-composer";

interface Plan {
  durationSeconds:number;
  shots:Array<{id:string;seconds:number}>;
  endCard:{image:string;seconds:number;headline:string};
  beats:Array<{caption:string;spoken:string;start:number;end:number}>;
  aiLabel:string;credit:string;
}

const run=(command:string,args:string[],cwd=process.cwd())=>new Promise<string>((ok,fail)=>{
  const child=spawn(command,args,{cwd,stdio:["ignore","ignore","pipe"]}),err:Buffer[]=[];
  child.stderr.on("data",d=>err.push(Buffer.from(d)));
  child.on("close",code=>code===0?ok(Buffer.concat(err).toString()):fail(new Error(Buffer.concat(err).toString().slice(-800))));
});

async function main(){
  const [planPath,shotsDir,outDir]=process.argv.slice(2).map(p=>resolve(p));
  const plan=JSON.parse(await readFile(planPath,"utf8")) as Plan;
  const ffmpeg=ffmpegBinary();if(!ffmpeg)throw new Error("ffmpeg_unavailable");
  await mkdir(join(outDir,"fonts"),{recursive:true});
  await copyFile(defaultThaiFontPath(),join(outDir,"fonts",THAI_FONT_FILE));
  const started=performance.now(),log:Record<string,unknown>={};

  // Narration: one VoxCPM2 take per beat, each held to its beat, then laid on the timeline at the beat start.
  const python=process.env.THAI_TTS_PYTHON;if(!python)throw new Error("THAI_TTS_PYTHON not set");
  const voice=new LocalCommandThaiVoice([python,process.env.THAI_TTS_SCRIPT??join(process.cwd(),"scripts/thai-tts/voxcpm2_tts.py")]);
  const takes=[];
  for(const [i,beat] of plan.beats.entries()){
    const t=performance.now();
    const take=await voice.synthesize({text:beat.spoken,outputPath:join(outDir,`voice-${i}.wav`),maxSeconds:Number((beat.end-beat.start-.1).toFixed(2))});
    takes.push({beat:i,seconds:Number(take.durationSeconds.toFixed(2)),ttsSeconds:Number(((performance.now()-t)/1000).toFixed(1))});
  }
  log.voice={engine:"openbmb/VoxCPM2 (Apache-2.0), local CPU",takes};
  const inputs=plan.beats.flatMap((_,i)=>["-i",join(outDir,`voice-${i}.wav`)]);
  const delays=plan.beats.map((b,i)=>`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(b.start*1000)}[d${i}]`).join(";");
  await run(ffmpeg,["-y","-loglevel","error",...inputs,"-filter_complex",`${delays};${plan.beats.map((_,i)=>`[d${i}]`).join("")}amix=inputs=${plan.beats.length}:normalize=0,apad,atrim=0:${plan.durationSeconds}[a]`,
    "-map","[a]",join(outDir,"narration.wav")]);

  const clips:ComposerClip[]=[...plan.shots.map(s=>({assetId:s.id,path:join(shotsDir,`${s.id}.mp4`),kind:"VIDEO" as const,seconds:s.seconds})),
    {assetId:"end",path:resolve(plan.endCard.image),kind:"IMAGE",seconds:plan.endCard.seconds,motion:"HOLD",layout:"FRAMED"}];
  const durations=clips.map(c=>c.seconds!);
  const captions=plan.beats.map(b=>({text:b.caption,start:b.start,end:b.end}));
  const endStart=durations.slice(0,-1).reduce((a,b)=>a+b,0);
  let ass=buildAssSubtitles(captions,plan.durationSeconds,[],shotOverlays(clips,durations));
  // The product fills the middle of these shots, so captions sit lower than on graphic clips (still above TikTok's bottom bar).
  ass=ass.replace(/^(Style: Caption,.*,)(\d+)(,222)$/m,(_,head,_v,tail)=>`${head}400${tail}`);
  // A machine-generated disclosure stays on screen for the whole clip (required by the video model's licence).
  ass=ass.replace("\n\n[Events]",`\nStyle: Label,Noto Sans Thai,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,8,0,9,40,40,150,222\nStyle: Headline,Noto Sans Thai,64,&H00111111,&H00FFFFFF,&H002EC8FF,&H002EC8FF,-1,0,0,0,100,100,2,0,3,14,0,8,40,40,1050,222\nStyle: Credit,Noto Sans Thai,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,6,0,2,40,40,330,222\n\n[Events]`)
    +`Dialogue: 3,0:00:00.00,0:00:${plan.durationSeconds.toFixed(2).padStart(5,"0")},Label,,0,0,0,,${plan.aiLabel}\n`
    +`Dialogue: 3,0:00:${(endStart+.05).toFixed(2).padStart(5,"0")},0:00:${plan.durationSeconds.toFixed(2).padStart(5,"0")},Headline,,0,0,0,,${plan.endCard.headline}\n`
    // The source photos are CC BY-SA: the photographer is credited on the closing shot.
    +`Dialogue: 3,0:00:${endStart.toFixed(2).padStart(5,"0")},0:00:${plan.durationSeconds.toFixed(2).padStart(5,"0")},Credit,,0,0,0,,${plan.credit}\n`;
  await writeFile(join(outDir,"subtitles.ass"),ass,"utf8");
  const gain=voiceGainDb(await measureLoudness(join(outDir,"narration.wav"),`aresample=48000,${VOICE_COMPRESSOR}`));
  const output=join(outDir,"ad.mp4");
  await run(ffmpeg,composerArgs({clips,durations,voicePath:join(outDir,"narration.wav"),voiceGainDb:gain,durationSeconds:plan.durationSeconds,outputPath:output}),outDir);
  const media=await new FFmpegVideoRenderer().probe(output);
  const lufs=await measureLoudness(output);
  log.media=media;log.loudnessLufs=lufs;
  log.checks=composerQc(media,lufs,{durationSeconds:plan.durationSeconds,hasVoice:true});
  log.assembleSeconds=Number(((performance.now()-started)/1000).toFixed(1));
  await writeFile(join(outDir,"assemble.json"),JSON.stringify(log,null,2));
  console.log(JSON.stringify(log));
}
main().catch(error=>{console.error(error);process.exit(1)});
