import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {serverEnv} from "@/lib/server-env";
import {assertProviderAdministrator} from "@/features/video-provider/access";
import {providerSettings,listProviderJobs} from "@/features/video-provider/service";
import {ProviderPanel,type ProviderJobView} from "./panel";
import "./styles.css";
export const maxDuration=300;
export default async function VideoProvidersPage({searchParams}:{searchParams:Promise<{project?:string}>}){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  try{assertProviderAdministrator(data.user);}catch{redirect("/auto");}
  const configuration=await providerSettings(client,data.user.id);
  if(!configuration.installed)return <section className="panel"><h1>ผู้ให้บริการวิดีโอ</h1><p>ยังไม่ได้ติดตั้งการปรับฐานข้อมูลสำหรับคิวนี้ ระบบเดิมทำงานตามเดิม และยังไม่เรียกบริการเสียเงิน</p><Link href="/video-factory">กลับ Video Factory</Link></section>;
  const admin=createAdminClient();
  const [jobs,projects,totals,history,params]=await Promise.all([
    listProviderJobs(client,data.user.id),
    client.from("creative_projects").select("id,product_id,tiktok_account_id").eq("owner_id",data.user.id).not("selected_script_id","is",null).order("created_at",{ascending:false}).limit(50),
    admin.rpc("video_provider_dashboard",{p_owner_id:data.user.id}),
    admin.from("video_provider_jobs").select("id,decisions").eq("owner_id",data.user.id).order("updated_at",{ascending:false}).limit(10),searchParams,
  ]);
  if(projects.error||totals.error||history.error)throw new Error("ไม่สามารถอ่านข้อมูลคิวได้");
  const rows=projects.data??[],[products,accounts]=rows.length?await Promise.all([
    client.from("products").select("id,title").eq("owner_id",data.user.id).in("id",rows.map(row=>row.product_id)),
    client.from("tiktok_accounts").select("id,display_name").eq("owner_id",data.user.id).in("id",rows.map(row=>row.tiktok_account_id))
  ]):[{data:[],error:null},{data:[],error:null}];
  if(products.error||accounts.error)throw new Error("ไม่สามารถอ่านรายการที่เลือกได้");
  const productNames=new Map(products.data?.map(row=>[row.id,row.title])),accountNames=new Map(accounts.data?.map(row=>[row.id,row.display_name]));
  const choices=rows.map(row=>({id:row.id,label:[productNames.get(row.product_id)??"สินค้า",accountNames.get(row.tiktok_account_id)??"บัญชี"].join(" · ")}));
  const decisions=(history.data??[]).flatMap(row=>(row.decisions as Array<{at:string;provider:string;reason:string}>).map(item=>({at:item.at,provider:item.provider,reason:item.reason}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,20);
  return <ProviderPanel settings={configuration.settings} jobs={jobs as ProviderJobView[]} choices={choices} selectedProject={params.project??""} totals={totals.data} history={decisions} enabled={process.env.VIDEO_PROVIDER_ROUTER_ENABLED==="true"} falConfigured={Boolean(serverEnv.falKey)}/>;
}
