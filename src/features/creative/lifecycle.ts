export interface CreativeAssignmentState {final_score:number;status:string}
export function canStartCreativeProject(a:CreativeAssignmentState){
  return Number.isFinite(Number(a.final_score))&&Number(a.final_score)>0&&!["BLOCKED","SKIPPED","EXPIRED"].includes(a.status);
}
export function nextProjectStatus(current:string,event:"GENERATE"|"GENERATED"|"SELECT"|"FAIL"|"ARCHIVE"){
  const transitions:Record<string,Partial<Record<typeof event,string>>>={
    DRAFT:{GENERATE:"GENERATING",ARCHIVE:"ARCHIVED"},GENERATING:{GENERATED:"READY",FAIL:"FAILED"},
    READY:{GENERATE:"GENERATING",SELECT:"SELECTED",ARCHIVE:"ARCHIVED"},SELECTED:{GENERATE:"GENERATING",ARCHIVE:"ARCHIVED"},
    FAILED:{GENERATE:"GENERATING",ARCHIVE:"ARCHIVED"},ARCHIVED:{},
  };
  const next=transitions[current]?.[event];if(!next)throw new Error(`Invalid creative lifecycle transition: ${current} -> ${event}`);return next;
}

