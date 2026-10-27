import {describe,it,expect} from "vitest";
import {PUBLIC_PRODUCT_MODELS,publicImageCandidate,permittedPublicImageUrl} from "./public-discovery";
describe("public product source filters",()=>{
  const info={descriptionurl:"https://commons.wikimedia.org/wiki/File:Casio_F-91W.jpg",thumburl:"https://thumb.wikimedia.org/photo.jpg",thumbwidth:960,thumbheight:960,width:2880,height:2880,mime:"image/jpeg",
    extmetadata:{LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"},Artist:{value:'<a href="/user">Photographer</a>'}}};
  const page={pageid:123,title:"File:Casio F-91W front.jpg",imageinfo:[info]};
  const candidate=(p:typeof page)=>publicImageCandidate(p,PUBLIC_PRODUCT_MODELS[0],"2026-10-28T00:00:00Z");
  it("preserves source/license without asserting a reviewed right or market metric",()=>{
    expect(candidate(page)).toMatchObject({creator:"Photographer",license:"CC BY-SA 4.0",pageId:123});
    expect(candidate(page)).not.toHaveProperty("unitsSold");expect(candidate(page)).not.toHaveProperty("rightsConfirmed");
  });
  it("rejects counterfeit, other models, restricted licenses and unbounded hosts",()=>{
    expect(candidate({...page,title:"File:Casio F-91W counterfeit.jpg"})).toBeNull();
    expect(candidate({...page,title:"File:Casio A168 front.jpg"})).toBeNull();
    expect(candidate({...page,imageinfo:[{...info,extmetadata:{...info.extmetadata,LicenseShortName:{value:"CC BY-NC 4.0"}}}]})).toBeNull();
    expect(candidate({...page,imageinfo:[{...info,thumburl:"https://127.0.0.1/private"}]})).toBeNull();
    expect(candidate({...page,imageinfo:[{...info,width:100}]})).toBeNull();
  });
  it("accepts only HTTPS images on the exact permitted hosts",()=>{
    expect(permittedPublicImageUrl(info.thumburl)).toBe(true);
    for(const url of ["http://thumb.wikimedia.org/x","https://thumb.wikimedia.org.evil.test/x","https://user:secret@thumb.wikimedia.org/x","https://thumb.wikimedia.org:444/x","file:///D:/private"])
      expect(permittedPublicImageUrl(url)).toBe(false);
  });
});
