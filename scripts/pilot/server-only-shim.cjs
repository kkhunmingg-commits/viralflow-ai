// Outside Next.js the "server-only" marker package is not resolvable; this pilot runs server code on purpose.
const Module=require("node:module");
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...rest){return request==="server-only"?__filename:resolve.call(this,request,...rest)};
