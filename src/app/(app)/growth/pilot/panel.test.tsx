import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect,vi} from "vitest";
vi.mock("./actions",()=>({enableGrowthPilotAction:vi.fn(),prepareGrowthPilotAction:vi.fn(),refreshGrowthPilotAction:vi.fn(),reportGrowthPostAction:vi.fn()}));
import {GrowthPilotDashboard} from "./panel";
it("does not offer execution before the server allows a Pilot or ask for topics/mode",()=>{
 const html=renderToStaticMarkup(<GrowthPilotDashboard initial={{available:false,active:false,message:"ยังไม่ได้เลือกบัญชีสำหรับทดลองฝั่งเซิร์ฟเวอร์"}}/>);
 expect(html).toContain("เลือกบัญชีทดลองก่อน");expect(html).not.toContain("เปิด Pilot");
 for(const field of ["open_id","access_token","user.info.stats","lease_token","เลือกหัวข้อ"])expect(html).not.toContain(field);
});
