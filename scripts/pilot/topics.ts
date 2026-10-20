/** Owner-recorded facts for Growth topics, each checked against the named public reference.
 * Facts are recorded cause first, which the rule-based storyteller relies on for explanations. */
export const GROWTH_TOPICS:Array<{topic:string;source:string;facts:string[]}>=[
  {topic:"ขวดเก็บความเย็น",source:"https://en.wikipedia.org/wiki/Vacuum_flask",facts:["ผนังขวดมีสองชั้น","ช่องกลางไม่มีอากาศ","ความร้อนผ่านได้น้อย"]},
  {topic:"น้ำแข็งลอยน้ำ",source:"https://en.wikipedia.org/wiki/Ice",facts:["น้ำแข็งเบากว่าน้ำราว 9%","น้ำขยายตัวเมื่อแข็งตัว","ปลาอยู่ใต้น้ำแข็งได้"]},
  {topic:"หม้อความดัน",source:"https://en.wikipedia.org/wiki/Pressure_cooking",facts:["น้ำเดือดได้ถึงราว 120°C","อาหารจึงสุกเร็วขึ้น","อย่าเปิดฝาขณะมีแรงดัน"]},
  {topic:"เกลือกับน้ำแข็ง",source:"https://en.wikipedia.org/wiki/Freezing-point_depression",facts:["เกลือทำให้จุดเยือกแข็งต่ำลง","น้ำเกลือเย็นกว่า 0°C ได้"]},
  {topic:"หมึกยักษ์",source:"https://en.wikipedia.org/wiki/Octopus",facts:["เลือดหมึกยักษ์ใช้ทองแดงขนออกซิเจน","เลือดหมึกยักษ์จึงเป็นสีฟ้า","หมึกยักษ์มีหัวใจ 3 ดวง"]},
  {topic:"ฟ้าแลบก่อนฟ้าร้อง",source:"https://en.wikipedia.org/wiki/Thunder",facts:["แสงเดินทางเร็วกว่าเสียงมาก","จึงเห็นฟ้าแลบก่อนได้ยินเสียง","เสียงใช้ราว 3 วินาทีต่อกิโลเมตร"]},
  {topic:"น้ำผึ้งเก็บได้นาน",source:"https://en.wikipedia.org/wiki/Honey",facts:["น้ำผึ้งมีน้ำน้อยและเป็นกรดอ่อน","เชื้อโรคจึงเติบโตได้ยาก","น้ำผึ้งจึงเก็บได้นานมาก"]},
];
