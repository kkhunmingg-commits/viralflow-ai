import {it,expect} from "vitest";
import {publicProductAttribution,captionWithAttribution} from "./public-attribution";
it("keeps all attribution and license text within the caption limit",()=>{
  const credit=publicProductAttribution({discovery:"PUBLIC_MODEL_IMAGE_SEARCH",source:{creator:"Multicherry",pageId:123456,license:"CC BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"}})!;
  const caption=captionWithAttribution("เรื่องสินค้า ".repeat(100),credit);
  expect(caption.length).toBeLessThanOrEqual(300);expect(caption.endsWith(credit)).toBe(true);
  expect(caption).toContain("ตัดต่อเป็นวิดีโอ");expect(caption).toContain("https://commons.wikimedia.org/?curid=123456");
  expect(publicProductAttribution({})).toBeNull();
  expect(()=>publicProductAttribution({discovery:"PUBLIC_MODEL_IMAGE_SEARCH",source:{}})).toThrow("PUBLIC_ATTRIBUTION_INVALID");
});
