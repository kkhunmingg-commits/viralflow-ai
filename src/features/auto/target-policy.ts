/** Owner-requested manual generation count is independent of the platform's publishing capacity. */
export function manualRunTargets(clips:number,postingCapacity:number){
  if(!Number.isSafeInteger(clips)||clips<1)throw new Error("invalid_operator_selection");
  return{desiredCandidates:clips,desiredPosts:Math.max(0,Math.min(clips,postingCapacity))};
}
