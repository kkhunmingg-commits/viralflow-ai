/** Symbols are written for the eye; the voice gets the words a Thai speaker would say.
 * Shared by the TTS provider and the storyteller's narration budget. */
export function spokenThai(text:string){
  return text.normalize("NFC").replace(/\s*°\s*C\b/g," องศาเซลเซียส").replace(/\s*%/g," เปอร์เซ็นต์").replace(/[:：]/g," ").replace(/\s+/g," ").trim();
}
