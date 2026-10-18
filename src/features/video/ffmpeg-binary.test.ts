import {describe,expect,it} from "vitest";
import {resolveFfmpegBinary} from "./ffmpeg-binary";

const filters=(names:string[])=>`Filters:\n  T.. = Timeline support\n${names.map(n=>` ... ${n}            V->V       test`).join("\n")}\n`;
describe("FFmpeg binary resolution",()=>{
  it("honours an explicit FFMPEG_BINARY without probing",()=>expect(resolveFfmpegBinary({env:{FFMPEG_BINARY:"/opt/ffmpeg"},candidates:["a"],probe:()=>{throw new Error("probed")}})).toBe("/opt/ffmpeg"));
  it("skips a bundled build that lacks drawtext",()=>expect(resolveFfmpegBinary({env:{},candidates:["bundled","system"],probe:b=>b==="bundled"?filters(["ass","scale"]):filters(["drawtext","scale"])})).toBe("system"));
  it("does not match drawtext as a substring of another filter",()=>expect(resolveFfmpegBinary({env:{},candidates:["a","b"],probe:b=>b==="a"?filters(["xdrawtextx"]):filters(["drawtext"])})).toBe("b"));
  it("falls back to the first runnable binary when none has drawtext",()=>expect(resolveFfmpegBinary({env:{},candidates:["missing","bundled"],probe:b=>b==="missing"?null:filters(["ass"])})).toBe("bundled"));
  it("returns null when no candidate exists",()=>expect(resolveFfmpegBinary({env:{},candidates:[null],probe:()=>null})).toBeNull());
});
