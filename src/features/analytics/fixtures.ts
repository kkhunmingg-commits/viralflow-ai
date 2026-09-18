import { defaultBaseline } from "./scoring";
import type { WinnerInput } from "./types";
const base={accountId:"account-a",ageHours:24,sourceConfidence:.95,categoryRelative:60,commerceAvailable:true,baseline:defaultBaseline(),likes:100,comments:20,shares:15,favorites:20,clicks:40,orders:2,gmv:600,commission:90} as const;
export const analyticsFixtures:Record<string,WinnerInput>={
 A:{...base,id:"A",mode:"GROWTH",views:5000,likes:700,comments:90,shares:180,favorites:210,followerDelta:80},
 B:{...base,id:"B",mode:"GROWTH",views:900,likes:25,comments:2,shares:1,favorites:2,followerDelta:0},
 C:{...base,id:"C",mode:"AFFILIATE",views:4000,clicks:260,orders:32,gmv:16000,commission:2400},
 D:{...base,id:"D",mode:"AFFILIATE",views:7000,clicks:20,orders:0,gmv:0,commission:0},
 E:{...base,id:"E",mode:"GROWTH",views:80,ageHours:1,likes:25,shares:8},
 F:{...base,id:"F",mode:"AFFILIATE",views:3000,commerceAvailable:false,clicks:null,orders:null,gmv:null,commission:null},
 G:{...base,id:"G",mode:"GROWTH",accountId:"account-b",views:1200,likes:130,shares:25,favorites:null},
 H:{...base,id:"H",mode:"AFFILIATE",views:2500,clicks:120,orders:2,gmv:900,commission:120},
 I:{...base,id:"I",mode:"AFFILIATE",views:2500,clicks:120,orders:18,gmv:9000,commission:1350},
 J:{...base,id:"J",mode:"GROWTH",views:5000,ageHours:360,likes:700,shares:180,favorites:210,followerDelta:80},
};
