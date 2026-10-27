import {describe,expect,it} from "vitest";
import {directorLearning,learnFromAdOutcomes,type AdOutcome} from "./ad-learning";

// Synthetic fixtures for the learning contract only; never production performance data.
const row=(i:number,format:AdOutcome["conceptFormat"],completion:number,over:Partial<AdOutcome>={}):AdOutcome=>({videoId:`v${i}`,productId:"p",conceptFormat:format,hook:"h",provider:"local",
  qualityDecision:"READY_FOR_OWNER_REVIEW",costThb:2,source:"OWNER_REPORT_IMPORT",publishedAt:"2026-10-01T00:00:00Z",observedAt:"2026-10-05T00:00:00Z",
  views:1000,avgWatchSeconds:5,completionRate:completion,engagements:40,productClicks:null,orders:null,commissionThb:null,...over});

describe("ad learning loop",()=>{
  it("withholds lift until a format has enough mature posts",()=>{
    const report=learnFromAdOutcomes([row(1,"LIFESTYLE",.6),row(2,"PRODUCT_DETAIL",.2),row(3,"PRODUCT_DETAIL",.2,{publishedAt:"2026-10-04T12:00:00Z"})],new Date("2026-10-06T00:00:00Z"));
    expect(report.excluded).toEqual([{videoId:"v3",reason:"TOO_EARLY_TO_COMPARE"}]);
    expect(report.formats.every(f=>f.evidence==="INSUFFICIENT"&&f.liftVsAccount===0)).toBe(true);
    expect(directorLearning(report)).toEqual([]);
  });
  it("prefers the better format once evidence is sufficient and counts failed clips in cost",()=>{
    const rows=[...Array.from({length:6},(_,i)=>row(i,"LIFESTYLE",.6)),...Array.from({length:6},(_,i)=>row(10+i,"BUYING_GUIDE",.25)),
      row(99,"BUYING_GUIDE",.1,{qualityDecision:"REVISE_STORYBOARD_OR_EDIT",views:null,costThb:4})];
    const report=learnFromAdOutcomes(rows,new Date("2026-10-06T00:00:00Z"));
    expect(report.formats[0]).toMatchObject({format:"LIFESTYLE",evidence:"SUFFICIENT"});
    expect(report.formats[0].liftVsAccount).toBeGreaterThan(0);expect(report.formats[1].liftVsAccount).toBeLessThan(0);
    expect(report.costPerUsableClipThb).toBeCloseTo((12*2+4)/12,2);
    expect(directorLearning(report).map(f=>f.format)).toEqual(["LIFESTYLE","BUYING_GUIDE"]);
  });
});
