import {VIDEO_BUCKET} from "./types";
export function videoStoragePath(ownerId:string,kind:"products"|"masters"|"variations",resourceId:string,fileName:string){
  if(!/^[0-9a-f-]{36}$/i.test(ownerId)||!resourceId||fileName.includes("..")||/[\\/]/.test(fileName))throw new Error("Invalid storage path");
  return `owner/${ownerId}/${kind}/${resourceId}/${fileName}`;
}
export function ownsVideoStoragePath(ownerId:string,path:string){return path.startsWith(`owner/${ownerId}/`)&&!path.includes("..")}
export const videoStorageBucket=VIDEO_BUCKET;
