"use client";
import { useActionState } from "react";
import { saveRecommendations } from "@/app/(app)/recommendations/actions";
export function AssignmentSaveForm() {
 const [state,action,pending]=useActionState(saveRecommendations,{message:""});
 return <form action={action}><button className="primary-action" disabled={pending}>{pending?"กำลังบันทึก…":"บันทึกแผนวันนี้"}</button><p role="status">{state.message}</p></form>;
}
