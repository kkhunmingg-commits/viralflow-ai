"use client";
import { useActionState } from "react";
import { seedProductRadar } from "@/app/(app)/product-radar/actions";
export function ProductSeedForm() {
  const [state,action,pending]=useActionState(seedProductRadar,{message:""});
  return <form action={action}><button className="primary-action" disabled={pending}>{pending?"กำลังนำเข้า…":"สร้างตัวอย่างสินค้า A–I"}</button><p role="status" className="muted">{state.message}</p></form>;
}
