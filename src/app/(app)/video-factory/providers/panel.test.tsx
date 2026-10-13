import {describe,it,expect,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn()}));
vi.mock("./actions",()=>({saveSettingsAction:vi.fn(),queueVideoAction:vi.fn(),advanceVideoAction:vi.fn(),googleBriefAction:vi.fn(),uploadTicketAction:vi.fn(),importVideoAction:vi.fn(),noGooglePendingAction:vi.fn(),processQueueAction:vi.fn(),testProviderAction:vi.fn(),observeKnownResultAction:vi.fn(),reconcileBillingAction:vi.fn()}));
import {ProviderPanel} from "./panel";
import {defaultProviderSettings} from "@/features/video-provider/contracts";
describe("protected provider dashboard presentation",()=>{
  it("shows honest unknown quota/billing and disabled paid execution without submitting",()=>{
    const html=renderToStaticMarkup(<ProviderPanel settings={defaultProviderSettings()} jobs={[]} choices={[]} selectedProject="" totals={{completed:0,failed:0,waiting:0,estimatedToday:0,estimatedMonth:0,actualMonth:null,unbilledMonth:0}} history={[]} enabled={false} falConfigured={false}/>);
    expect(html).toContain("Assisted Mode");expect(html).toContain("โควตาใช้/เหลือ: ยังไม่ทราบ");expect(html).toContain("ยังไม่เปิดใช้งานคิวนี้");expect(html).not.toContain("checked=\"\"");
    expect(html).not.toContain("FAL_KEY");expect(html).not.toContain("service_role");expect(html).toContain("อ่านราคาเท่านั้น");
  });
  it("offers all three generation choices without enabling paid mode or claiming API billing readiness",()=>{
    const html=renderToStaticMarkup(<ProviderPanel settings={defaultProviderSettings()} jobs={[]} choices={[]} selectedProject="" totals={{completed:0,failed:0,waiting:0,estimatedToday:0,estimatedMonth:0,actualMonth:null,unbilledMonth:0}} history={[]} enabled={false} falConfigured={false} geminiConfigured/>);
    expect(html).toContain('value="GOOGLE_ONLY"');expect(html).toContain('value="GEMINI_ONLY"');expect(html).toContain('value="FAL_ONLY"');
    expect(html).toContain('value="TEXT_TO_VIDEO"');expect(html).toContain('value="IMAGE_TO_VIDEO"');
    expect(html).toContain('name="paidMode"');expect(html).not.toContain('checked=""');
    expect(html).toContain("ยังไม่ยืนยัน Billing หรือการสร้างคลิปจริง");expect(html).toContain("แยกจากสมาชิก Google Vids");
    expect(html).not.toContain("GEMINI_API_KEY");expect(html).not.toContain("GOOGLE_API_KEY");
    expect(html).toContain("เครดิตสมาชิก Pro/Ultra อาจชำระยอดได้");expect(html).toContain("ยอดก่อนหักเครดิต");
  });
});
