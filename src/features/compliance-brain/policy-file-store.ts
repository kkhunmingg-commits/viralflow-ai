import {createHash,randomUUID} from "node:crypto";
import {mkdir,open,readFile,rename,stat,unlink} from "node:fs/promises";
import {join,resolve} from "node:path";
import type {SignedPolicyPack} from "./policy-pack";
import {emptyPolicyRegistryState,type PolicyRegistryState,type PolicyRegistryStore} from "./policy-registry";

/** Server-owned storage outside the app bundle. Do not expose its directory to customer writes. */
export class FilePolicyRegistryStore implements PolicyRegistryStore {
  private readonly directory:string;
  constructor(directory:string,private readonly lockTimeoutMs=5000){this.directory=resolve(directory)}
  private async readJson(path:string):Promise<unknown|null>{
    try{if((await stat(path)).size>20_000_000)throw new Error("POLICY_STORE_TOO_LARGE");return JSON.parse(await readFile(path,"utf8")) as unknown}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error}
  }
  private async writeJson(path:string,value:unknown){
    const json=JSON.stringify(value);if(Buffer.byteLength(json,"utf8")>20_000_000)throw new Error("POLICY_STORE_TOO_LARGE");
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const temp=join(this.directory,`.policy-${randomUUID()}.tmp`),handle=await open(temp,"wx",0o600);
    try{try{await handle.writeFile(json,"utf8");await handle.sync()}finally{await handle.close()}await rename(temp,path)}
    catch(error){await unlink(temp).catch(()=>undefined);throw error}
  }
  async withMutationLock<T>(mutation:()=>Promise<T>):Promise<T>{
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,".registry.lock"),deadline=Date.now()+this.lockTimeoutMs;
    let handle;
    while(!handle){
      try{handle=await open(path,"wx",0o600)}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
        if(Date.now()>=deadline)throw new Error("POLICY_STORE_LOCKED");
        await new Promise(done=>setTimeout(done,25));
      }
    }
    try{return await mutation()}finally{await handle.close();await unlink(path)}
  }
  async readState():Promise<PolicyRegistryState>{
    return(await this.readJson(join(this.directory,"registry.json")) as PolicyRegistryState|null)??emptyPolicyRegistryState();
  }
  async writeState(state:PolicyRegistryState){await this.writeJson(join(this.directory,"registry.json"),state)}
  private lastPath(key:string){return join(this.directory,`last-good-${createHash("sha256").update(key).digest("hex")}.json`)}
  async readLastKnownGood(key:string):Promise<SignedPolicyPack|null>{
    const stored=await this.readJson(this.lastPath(key)) as {disabled?:boolean;pack?:SignedPolicyPack}|null;
    return stored?.disabled?null:stored?.pack??null;
  }
  async writeLastKnownGood(key:string,pack:SignedPolicyPack){await this.writeJson(this.lastPath(key),{pack})}
  async disableLastKnownGood(key:string){await this.writeJson(this.lastPath(key),{disabled:true})}
}
