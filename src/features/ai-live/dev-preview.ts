export async function readGeneratedFrame(response: Response, previousCount: number): Promise<{ count: number; blob: Blob } | null> {
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Preview HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("Preview did not return a generated JPEG");
  const count = Number(response.headers.get("x-frame-count"));
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Preview missing real frame counter");
  if (count <= previousCount) return null;
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) throw new Error("Preview contained invalid JPEG bytes");
  return { count, blob };
}
