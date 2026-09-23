"use server";

import { revalidatePath } from "next/cache";
import { applyOwnerOperationsAction, manualActionSchema } from "@/features/operations/services";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function operatorAction(form: FormData) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
  await enforceOwnerMutationRateLimit("operations", data.user.id);
  const input = manualActionSchema.parse({
    incidentId: form.get("incidentId"), action: form.get("action"),
    idempotencyKey: form.get("idempotencyKey"), evidence: form.get("evidence") || undefined,
    externalId: form.get("externalId") || undefined,
  });
  await applyOwnerOperationsAction(createAdminClient(), data.user.id, input);
  revalidatePath("/operations");
}
