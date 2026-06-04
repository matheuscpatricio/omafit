/**
 * Smoke test: scoring snap + heurísticas de extents (sem GLB).
 * node scripts/test-glasses-canonical-extents.mjs
 */
import assert from "node:assert/strict";

function scoreGlassesHardCanonicalExtents(sx, sy, sz, rotMag) {
  const maxDim = Math.max(sx, sy, sz, 1e-9);
  const minDim = Math.min(sx, sy, sz, 1e-9);
  const midDim = sx + sy + sz - maxDim - minDim;
  const xLargest = sx / maxDim;
  const yIsSmallest = sy <= minDim * 1.02;
  const zIsMiddle = Math.abs(sz - midDim) <= Math.max(midDim, 1e-9) * 0.12;
  const ySmallest = yIsSmallest ? minDim / Math.max(sy, 1e-9) : 0;
  const zMiddle = zIsMiddle
    ? 1
    : 1 - Math.min(1, Math.abs(sz - midDim) / Math.max(midDim, 1e-9));
  return xLargest * 0.65 + ySmallest * 0.25 + zMiddle * 0.1 - rotMag * 0.00015;
}

import {
  applyMat4RotateXNeg90ToVec3,
  glassesExtentsMatchWidgetFrame,
} from "../shared/ar-eyewear-glasses-canonical.mjs";

const widgetFrameExtentsMatch = glassesExtentsMatchWidgetFrame;

function rodinPreRemapExtentsMatch(sx, sy, sz) {
  const dims = [
    { v: sx, i: 0 },
    { v: sy, i: 1 },
    { v: sz, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[0].i !== 1 || dims[1].i !== 2 || dims[2].i !== 0) return false;
  return dims[1].v > dims[0].v * 1.05;
}

/** Legado v185: aceitava Rodin pré-remap como widget (bug). */
function legacyFalsePositiveWidget(sx, sy, sz) {
  const dims = [
    { v: sx, i: 0 },
    { v: sy, i: 1 },
    { v: sz, i: 2 },
  ].sort((a, b) => a.v - b.v);
  if (dims[2].i !== 0) return false;
  if (dims[0].i === 2 && dims[1].i === 1) return dims[1].v > dims[0].v * 1.05;
  if (dims[0].i === 1 && dims[1].i === 2) return dims[1].v > dims[0].v * 1.05;
  return false;
}

const rodin = [0.14, 0.02, 0.08];
const widget = [0.14, 0.08, 0.02];
const yTall = [0.08, 0.14, 0.02];

assert(scoreGlassesHardCanonicalExtents(...rodin, 0) > scoreGlassesHardCanonicalExtents(...widget, 0));
assert(rodinPreRemapExtentsMatch(...rodin));
assert(!widgetFrameExtentsMatch(...rodin));
assert(widgetFrameExtentsMatch(...widget));
assert(!widgetFrameExtentsMatch(...yTall));
assert(legacyFalsePositiveWidget(...rodin), "legado marcava Rodin como widget");
assert(!legacyFalsePositiveWidget(...widget) || widgetFrameExtentsMatch(...widget));

const [rx, ry, rz] = applyMat4RotateXNeg90ToVec3(0, 0, 1);
assert(Math.abs(rx) < 1e-9 && Math.abs(ry - 1) < 1e-9 && Math.abs(rz) < 1e-9, "Rx(-90): +Z → +Y");
const [fx, fy, fz] = applyMat4RotateXNeg90ToVec3(0, 1, 0);
assert(Math.abs(fx) < 1e-9 && Math.abs(fy) < 1e-9 && Math.abs(fz + 1) < 1e-9, "Rx(-90): +Y → −Z");

console.log("test-glasses-canonical-extents: ok");
