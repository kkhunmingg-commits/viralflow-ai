"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {assertProviderAdministrator} from "@/features/video-provider/access";
import {enforceOwnerMutationRateLimit} from "@/lib/security/rate-limit";
import {importPublicProduct} from "@/features/products/public-discovery-service";
export async function importDiscoveredProduct(form:FormData){
  const client=await createClient(),{data}=await client.auth.getUser();assertProviderAdministrator(data.user);
  if(!data.user)throw new Error("Authentication required");
  await enforceOwnerMutationRateLimit("product-radar",data.user.id);
  const input=z.object({model:z.string().min(1).max(80),pageId:z.coerce.number().int().positive()}).parse(Object.fromEntries(form));
  const result=await importPublicProduct(createAdminClient(),data.user.id,input.model,input.pageId);
  revalidatePath("/product-radar");redirect(`/product-radar/${result.productId}`);
}
