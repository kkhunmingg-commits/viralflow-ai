import Script from "next/script";

/**
 * Runs before React: keeps Chrome's one-time install prompt (it can fire before hydration) and registers the
 * service worker. The install button reads window.__vfInstallPrompt and listens for "vf-installable".
 */
const boot = `(function(){
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__vfInstallPrompt=e;window.dispatchEvent(new Event('vf-installable'));});
  window.addEventListener('appinstalled',function(){window.__vfInstallPrompt=null;window.dispatchEvent(new Event('vf-installed'));});
  if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){});});}
})();`;

export function PwaBoot() {
  return <Script id="vf-pwa-boot" strategy="beforeInteractive">{boot}</Script>;
}
