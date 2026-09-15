"use client";
import {useActionState} from "react";
import {buildCategoryIntelligence} from "@/app/(app)/categories/actions";
export function CategoryBuildForm(){const[state,action,pending]=useActionState(buildCategoryIntelligence,{message:""});return <form action={action}><button className="primary-action" disabled={pending}>{pending?"กำลังประมวลผล…":"ประมวลผล Category Intelligence"}</button><p role="status" className="muted">{state.message}</p></form>}
