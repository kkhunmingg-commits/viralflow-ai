// Outside Next.js the "server-only" marker package is not resolvable; this pilot runs server code on purpose.
import Module from "node:module";
import {fileURLToPath} from "node:url";
const empty=fileURLToPath(new URL("./empty.cjs",import.meta.url));
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...rest){return request==="server-only"?empty:resolve.call(this,request,...rest)};
