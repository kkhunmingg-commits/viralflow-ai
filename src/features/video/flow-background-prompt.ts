/** Flow supplies atmosphere/audio; the editor adds the reviewed photograph without AI reconstruction. */
export function flowBackgroundPrompt(voiceScript:string){
  if(!voiceScript.trim()||voiceScript.length>180)throw new Error("FLOW_NARRATION_INVALID");
  return `Create exactly 8 seconds of vertical 9:16 video at 720p. An elegant abstract navy and cyan studio-light atmosphere, subtle moving light gradients, calm uncluttered center. Background only: no watch, product, packaging, hands, people, mechanism, logos or readable text. This is an AI background, not a real product demonstration. The editor will add the original product photograph and Thai captions separately without reconstructing the product. Audio: a clear, natural Thai narrator speaks exactly the following narration, completing it within 8 seconds, with no added claims or words: ${JSON.stringify(voiceScript)}. Keep the narrator intelligible; any ambient sound must be quiet. Do not translate the narration.`;
}
