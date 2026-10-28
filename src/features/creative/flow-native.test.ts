import {describe,expect,it} from "vitest";
import {planFlowNative} from "./flow-native";

const casio={product:{id:"p",title:"Casio F-91W",categoryKey:"watch"},facts:[{id:"f1",text:"นาฬิกาดิจิทัล"},{id:"f2",text:"น้ำหนัก 21 กรัม"}],
  assets:[{id:"img",kind:"REAL_IMAGE" as const,rightsCleared:true}]};

describe("flow-native shot director",()=>{
  it("plans one photoreal take with hands in a styled set and pins product fidelity",()=>{
    const plan=planFlowNative(casio,{creditsPerGeneration:10});
    expect(plan.selected).toHaveLength(1);expect(plan.generations).toBe(1);expect(plan.estimatedCredits).toBe(10);
    const shot=plan.selected[0];
    expect(["LIFT_AND_PRESENT","POINT_TO_DETAIL"]).toContain(shot.action);
    expect(shot.prompt).toContain("Use the attached reference image as the exact product (Casio F-91W)");
    expect(shot.prompt).toContain("stays perfectly still");expect(shot.prompt).toContain("within the first half second");expect(shot.prompt).toContain("one continuous take");
    expect(shot.negative.join(" ")).toMatch(/testimonials, captions/);expect(shot.negative).toContain("gloves, mittens or covered hands");
    expect(shot.narrationTh).toBe("Casio F-91W น้ำหนัก 21 กรัม");
    expect(shot.fidelityNotes.join(" ")).toContain("ตัวเลข");
    expect(plan.tasteBasis.some(t=>t.startsWith("ไม่เอา"))).toBe(true);
  });
  it("varies takes for longer adverts and avoids recently used sets",()=>{
    const first=planFlowNative(casio).selected[0];
    const next=planFlowNative({...casio,history:{styleIds:[first.style.id],actions:[first.action]}}).selected[0];
    expect(next.style.id===first.style.id&&next.action===first.action).toBe(false);
    const long=planFlowNative(casio,{durationSeconds:24});
    expect(long.selected).toHaveLength(3);expect(new Set(long.selected.map(s=>s.action)).size).toBe(3);
  });
  it("uses a different set library per category and requires a cleared reference image",()=>{
    const beauty=planFlowNative({...casio,product:{id:"b",title:"Serum",categoryKey:"beauty"}}).selected[0];
    expect(beauty.style.id).not.toBe(planFlowNative(casio).selected[0].style.id);
    expect(()=>planFlowNative({...casio,assets:[]})).toThrow("FLOW_NATIVE_REQUIRES_CLEARED_PRODUCT_IMAGE");
  });
});
