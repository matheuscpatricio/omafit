/**
 * Wrapper Node: `postprocessGlassesCanonicalGlbBuffer` → Buffer.
 */
import { Buffer } from "node:buffer";
import { postprocessGlassesCanonicalGlbBuffer as postprocessToUint8 } from "../shared/ar-eyewear-glasses-canonical.mjs";

/** @param {Buffer | Uint8Array} buf @param {object} [params] @returns {Promise<Buffer>} */
export async function postprocessGlassesCanonicalNodeBuffer(buf, params = {}) {
  const u8 = await postprocessToUint8(buf, params);
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}
