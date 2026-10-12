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
});
