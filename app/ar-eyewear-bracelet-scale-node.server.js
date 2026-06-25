import { Buffer } from "node:buffer";
import { postprocessBraceletScaleGlbBuffer } from "../shared/ar-eyewear-bracelet-scale.mjs";

/** @param {Buffer | Uint8Array} buf @param {Record<string, unknown>} [params] @returns {Promise<Buffer>} */
export async function postprocessBraceletScaleNodeBuffer(buf, params = {}) {
  const u8 = await postprocessBraceletScaleGlbBuffer(buf, params);
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}
