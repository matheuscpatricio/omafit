/**
 * Wrapper Node: devolve `Buffer` para o resto da app (`storageUpload`, etc.).
 * Lógica partilhada: `shared/ar-eyewear-glb-canonicalize.mjs` (também usada na Edge Deno).
 */
import { Buffer } from "node:buffer";
import { canonicalizeArEyewearGlbBuffer as canonicalizeToUint8 } from "../shared/ar-eyewear-glb-canonicalize.mjs";

/** @param {Buffer | Uint8Array} buf @returns {Promise<Buffer>} */
export async function canonicalizeArEyewearGlbBuffer(buf) {
  const u8 = await canonicalizeToUint8(buf);
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}
