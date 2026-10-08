import {notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {requirePolicyAdmin} from "@/features/compliance-brain/store";
import {readPolicyConsole} from "@/features/compliance-brain/admin-api";
import {policyCommandAction} from "./actions";
export default async function CompliancePolicyConsole(){
  const userClient=await createClient();const {data,error}=await userClient.auth.getUser();
  if(error||!data.user)notFound();
  try{requirePolicyAdmin(data.user)}catch{notFound()}
  const consoleData=await readPolicyConsole(createAdminClient(),data.user);
  return <div className="dashboard-page"><header className="page-heading"><p className="eyebrow">INTERNAL POLICY MANAGEMENT</p>
    <h1>Compliance Brain</h1><p>Validated signed packs, rollback, and aggregate shadow learning. Activation requires trusted server keys and a regression validation record.</p></header>
    <section className="panel"><h2>Policy versions</h2>{consoleData.policies.length?<div className="radar-table-wrap"><table className="radar-table">
      <thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Checksum</th><th>Validation</th><th>Controls</th></tr></thead>
      <tbody>{consoleData.policies.map(policy=><tr key={policy.version}><td>{policy.version}</td><td>{policy.status}</td><td>{policy.effective_at}</td>
        <td><code>{policy.checksum.slice(0,16)}</code></td><td>{policy.validated_at?"Regression recorded":"Not validated"}</td>
        <td>{policy.status==="ACTIVE"?<form action={policyCommandAction}><input type="hidden" name="version" value={policy.version}/><button name="action" value="deactivate">Deactivate</button></form>
          :["VALIDATED","RETIRED"].includes(policy.status)&&policy.validated_at&&policy.validation_hash?<form action={policyCommandAction}><input type="hidden" name="version" value={policy.version}/>
            <button name="action" value={policy.status==="RETIRED"?"rollback":"activate"}>{policy.status==="RETIRED"?"Rollback to this version":"Activate"}</button></form>:"Import and validate first"}</td></tr>)}</tbody>
    </table></div>:<p>No policy packs have been persisted. An absent or untrusted pack does not produce a safe verdict.</p>}</section>
    <section className="panel"><h2>Learned risks and shadow results</h2>{consoleData.learning.length?<div className="radar-table-wrap"><table className="radar-table"><thead><tr>
      <th>Category / rule</th><th>Lifecycle</th><th>Samples / tenants</th><th>Confidence</th><th>False positives</th><th>Shadow block / rewrite</th><th>Shadow evaluated / unavailable</th></tr></thead><tbody>
      {consoleData.learning.map(pattern=><tr key={String(pattern.id)}><td>{String(pattern.category)} / {String(pattern.semantic_category)}</td><td>{String(pattern.lifecycle)}</td>
        <td>{String(pattern.sample_count)} / {String(pattern.tenant_count)}</td><td>{Math.round(Number(pattern.confidence)*100)}%</td><td>{Math.round(Number(pattern.false_positive_rate)*100)}%</td>
        <td>{String(pattern.shadow_would_block)} / {String(pattern.shadow_would_rewrite)}</td>
        <td>{String(pattern.shadow_evaluated_count)} / {String(pattern.shadow_unavailable_count)}</td></tr>)}</tbody></table></div>:<p>No aggregate learning observations yet. New candidates remain in observation/shadow stages until validation and admin approval.</p>}
      <p>Shadow results replay typed historical signals. They do not change POST/LIVE decisions and do not establish independent holdout calibration.</p></section>
  </div>;
}
