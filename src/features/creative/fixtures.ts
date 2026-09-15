import { assignmentFixtures } from "../assignments/fixtures";
import { buildCreativeContext } from "./context";
export function creativeFixture(mode:"GROWTH"|"AFFILIATE"="GROWTH",category="beauty"){
  const base=assignmentFixtures(),account=base.accounts.find(a=>a.effective_mode===mode)!;
  const evidence=base.products.find(p=>p.product.category_key===category)??base.products[0];
  const cat=base.categories.find(c=>c.key===evidence.product.category_key)!;
  return buildCreativeContext({
    assignment:{id:"assignment-fixture",final_score:80,reason_json:{plannerReason:"Strongest eligible fit"}},
    account:{id:account.id,display_name:account.display_name,effective_mode:mode,follower_count:account.follower_count,preferred_categories:account.preferred_categories},
    product:{id:evidence.product.id,title:evidence.product.title,category_key:evidence.product.category_key,current_price:evidence.product.current_price,original_price:evidence.product.original_price,commission_rate:evidence.product.commission_rate,commission_amount:evidence.product.commission_amount,rating:evidence.product.rating,review_count:evidence.product.review_count},
    productScore:{product_momentum_score:evidence.momentum,creative_potential_score:evidence.creative,data_confidence:evidence.confidence},
    categoryScore:{category_momentum_score:cat.momentum,commercial_opportunity_score:cat.commercial,state:"HOT",confidence_component:cat.confidence*100,saturation_component:cat.saturation*100},
    affinity:{affinity_score:.9,confidence:.9},assignmentScore:{account_product_fit_score:85,final_viral_opportunity_score:80},
  });
}
