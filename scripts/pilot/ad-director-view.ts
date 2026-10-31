/** Read-only developer check: prints the AI Creative Director view the Creative Studio page renders for one
 * real project, using the same service. No writes, no model spend, no Flow generation.
 *   node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/ad-director-view.ts <owner-uuid> <project-uuid> */
async function main(){
  const [owner,projectId]=process.argv.slice(2);
  if(![owner,projectId].every(v=>/^[a-f0-9-]{36}$/i.test(v??"")))throw new Error("Usage: ownerUUID projectUUID");
  process.loadEnvFile(".env.local");
  const [{createAdminClient},{readAdDirectorView}]=await Promise.all([import("../../src/lib/supabase/admin"),import("../../src/features/creative/ad-director-service")]);
  const view=await readAdDirectorView(createAdminClient(),owner,projectId);
  console.log(JSON.stringify({ranking:{mode:view.ranking.mode,headline:view.ranking.headline,opportunity:view.ranking.items[0]?.opportunity.score,confidence:view.ranking.items[0]?.dataConfidence,eligibility:view.ranking.items[0]?.eligibility},
    evidence:view.evidence,mode:view.plan.mode,modeReason:view.plan.modeReason,selected:view.plan.selectedConceptId,
    concepts:view.plan.concepts.map(c=>({id:c.id,format:c.formatLabel,hook:c.hook.text,points:c.sellingPoints.map(p=>p.text),cta:c.cta,score:view.plan.critiques.find(r=>r.conceptId===c.id)?.total})),
    storyboard:view.storyboard?.scenes.map(s=>`${s.start}-${s.end} ${s.role} ${s.layout} ${s.onScreen.headline}`),issues:view.storyboardIssues,flow:view.flow&&{generations:view.flow.generations,credits:view.flow.estimatedCredits,notes:view.flow.notes}},null,1));
}
main().catch(e=>{console.error(e);process.exit(1)});
