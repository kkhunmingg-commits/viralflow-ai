import Link from "next/link";
import type { AssignmentInput, PairScore } from "@/features/assignments/types";
import { number } from "@/components/product-presentation";
import { createCreativeFromRecommendation } from "@/app/(app)/creative-studio/actions";
export function RecommendationTable({scores,input}:{scores:PairScore[];input:AssignmentInput}) {
  const products=new Map(input.products.map(p=>[p.product.id,p.product]));
  if(!scores.length)return <p className="muted">ยังไม่มีสินค้าที่ผ่านเงื่อนไขสำหรับบัญชีนี้</p>;
  return <div className="radar-table-wrap"><table className="radar-table">
    <thead><tr><th>Product</th><th>Category</th><th>Product Momentum</th><th>Category Momentum</th><th>Account Affinity</th><th>Account Fit</th><th>Final Opportunity</th><th>Reason</th><th>Creative</th></tr></thead>
    <tbody>{scores.map(s=><tr key={s.accountId+":"+s.productId}>
      <td><Link href={`/product-radar/${s.productId}`}>{products.get(s.productId)?.title??s.productId}</Link></td>
      <td>{s.categoryKey}</td><td>{number(s.product_component)}</td><td>{number(s.category_component)}</td>
      <td>{number(s.account_category_component)}%</td><td>{number(s.account_product_fit_score)}</td>
      <td className="opportunity-cell">{number(s.final_viral_opportunity_score)}</td>
      <td><details><summary>เหตุผลที่แนะนำ</summary><p>{s.explanation_json.whyProduct}</p><p>{s.explanation_json.whyAccount}</p><p>{s.explanation_json.whyNow}</p></details></td>
      <td><form action={createCreativeFromRecommendation}><input type="hidden" name="accountId" value={s.accountId}/><input type="hidden" name="productId" value={s.productId}/><button className="secondary-action">CREATE CREATIVE</button></form></td>
    </tr>)}</tbody></table></div>;
}
