export function assertProviderAdministrator(user:{app_metadata?:Record<string,unknown>}|null){
  if(!user || !["admin","developer"].includes(String(user.app_metadata?.viralflow_role)))throw new Error("PROVIDER_ADMIN_REQUIRED");
}
