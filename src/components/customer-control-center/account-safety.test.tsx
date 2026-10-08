import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {summarizeAccountSafety,unavailableAccountSafety} from "@/features/compliance-brain/presentation";
import {AccountSafetyCard} from "./account-safety";

describe("customer Account Safety rendering",()=>{
  it("serializes and renders only aggregate results without internal identifiers or reasons",()=>{
    const rows=[{id:"private-decision-id",account_id:"private-account-id",channel:"POST" as const,
      stage:"FINAL_PUBLISH",content_hash:"private-content-hash",decision:"BLOCK" as const,
      checked_at:"2026-10-07T00:00:00Z",policy_version:"private-policy-version",
      reasons:[{code:"private-reason-code",message:"private-reason-text"}]}];
    const summary=summarizeAccountSafety(rows,"private-account-id","2026-10-07T00:00:00Z");
    const serialized=JSON.stringify(summary);
    const html=renderToStaticMarkup(<AccountSafetyCard summary={summary}/>);
    expect(html).toContain("Account Safety");
    expect(html).toContain("ถูกบล็อกเพื่อป้องกันบัญชี");
    expect(html).toContain("0%");
    expect(html).toContain("1 รายการใน 30 วันที่ผ่านมา");
    for(const output of [serialized,html]){
      expect(output).not.toMatch(/private-|policy_version|content_hash|account_id|reasons/);
    }
  });

  it("shows empty and unavailable states without a fabricated safety percentage",()=>{
    const empty=renderToStaticMarkup(<AccountSafetyCard summary={summarizeAccountSafety([],"account")}/>);
    const unavailable=renderToStaticMarkup(<AccountSafetyCard summary={unavailableAccountSafety()}/>);
    const fallback=renderToStaticMarkup(<AccountSafetyCard/>);
    expect(empty).toContain("ยังไม่มีผลตรวจเนื้อหาก่อนโพสต์หรือก่อนพูด LIVE");
    expect(unavailable).toContain("ข้อมูลการตรวจยังไม่พร้อม");
    expect(fallback).toContain("ข้อมูลการตรวจยังไม่พร้อม");
    for(const output of [empty,unavailable,fallback]){
      expect(output).not.toContain("%");
      expect(output).not.toContain('class="account-safety-status');
      expect(output).not.toContain('class="account-safety-metrics"');
    }
  });

  it.each(["PASS","PASS_WITH_WARNING"] as const)("shows applied rewrites only after the final %s verdict",decision=>{
    const row={id:"private-id",account_id:"private-account",channel:"LIVE" as const,stage:"LIVE_SPEECH",
      content_hash:"private-hash",decision,rewritten:true,checked_at:"2026-10-07T00:00:00Z",
      rewrites_json:[{inputHash:"private-input-hash",outputHash:"private-output-hash",status:decision}]};
    const summary=summarizeAccountSafety([row],"private-account");
    const html=renderToStaticMarkup(<AccountSafetyCard summary={summary}/>);
    expect(html).toContain("ปรับคำแล้ว");
    expect(html).toContain("100%");
    expect(html).toContain('class="account-safety-status rewritten"');
    expect(JSON.stringify(summary)+html).not.toMatch(/private-|rewrites_json|inputHash|outputHash/);
  });

  it("shows an unapplied rewrite proposal as requiring review",()=>{
    const summary=summarizeAccountSafety([{id:"pending-id",account_id:"account",channel:"POST",stage:"FINAL_PUBLISH",
      content_hash:"pending-hash",decision:"AUTO_REWRITE",rewritten:false,checked_at:"2026-10-07T00:00:00Z"}],"account");
    const html=renderToStaticMarkup(<AccountSafetyCard summary={summary}/>);
    expect(html).toContain("ควรตรวจสอบ");
    expect(html).toContain('class="account-safety-status review"');
    expect(html).not.toContain("ปรับคำแล้ว");
    expect(summary.reviewRequired).toBe(1);
  });
});
