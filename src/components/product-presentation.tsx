import Image from "next/image";
import type { Trend } from "@/features/products/types";
export const money=(n:number)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"}).format(n);
export const number=(n:number)=>new Intl.NumberFormat("th-TH",{maximumFractionDigits:2}).format(n);
export function ProductImage({url,title}:{url:string|null;title:string}) {
  return <Image className="product-image" src={url??"/product-placeholder.svg"} alt={url?title:"ยังไม่มีภาพสินค้า"} width={160} height={160} unoptimized />;
}
export function TrendBadge({trend}:{trend:Trend}) {
  return <span className={`trend-badge trend-${trend.toLowerCase()}`}>{trend}</span>;
}
