import {it,expect} from "vitest";
import {manualRunTargets} from "./target-policy";
it("does not impose a 15 minimum or 20/200 maximum while preserving real posting caps",()=>{
  expect(manualRunTargets(1,2)).toEqual({desiredCandidates:1,desiredPosts:1});
  expect(manualRunTargets(211,3)).toEqual({desiredCandidates:211,desiredPosts:3});
  expect(manualRunTargets(1250,0)).toEqual({desiredCandidates:1250,desiredPosts:0});
  expect(()=>manualRunTargets(Infinity,3)).toThrow();
});
