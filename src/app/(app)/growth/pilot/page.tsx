import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { growthPilotView } from "@/features/growth-manager/service";
import { GrowthPilotDashboard } from "./panel";
import "../../auto/accounts/styles.css";
import "../../post/post.css";
import "./styles.css";
export const metadata={title:"ปั้นบัญชี · Viral Flow AI"};
export default async function GrowthPilotPage(){const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login?next=/growth/pilot");return <GrowthPilotDashboard initial={await growthPilotView(createAdminClient(),data.user.id)}/>;}
