import type { CategoryState } from "@/features/categories/types";
export const number=(value:number,digits=1)=>new Intl.NumberFormat("th-TH",{maximumFractionDigits:digits}).format(value);
export function CategoryStateBadge({state}:{state:CategoryState}){return <span className={`category-state state-${state.toLowerCase()}`}>{state}</span>;}
