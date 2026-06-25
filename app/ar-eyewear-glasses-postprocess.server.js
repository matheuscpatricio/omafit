/**
 * Pós-processo óculos no Node — `glasses_canonical` nativo (@gltf-transform) por defeito.
 * Python `run_recipe.py` só com AR_MESH_NODE_RUN_RECIPE_PYTHON=1 e Python validado.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postprocessGlassesCanonicalNodeBuffer } from "./ar-eyewear-glasses-canonical-node.server.js";
import { canonicalizeArEyewearGlbBuffer } from "./ar-eyewear-glb-canonicalize.server.js";
import {
  logPythonProbeOnce,
  launchIsRunnable,
  probePythonForRunRecipe,
} from "./ar-mesh-python-bin.server.js";

logPythonProbeOnce();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OMAFIT_ROOT = path.join(__dirname, "..");
const RUN_RECIPE_SCRIPT = path.join(
  OMAFIT_ROOT,
  "workers",
  "ar-mesh-generate",
  "postprocess",
  "run_recipe.py",
);

/**
 * @param {{ bin: string, prefixArgs: string[] }} launch
 * @param {string} recipe
 * @param {string} inp
 * @param {string} out
 * @param {Record<string, unknown>} params
 * @returns {Promise<void>}
 */
function runRecipeSubprocess(launch, recipe, inp, out, params) {
  const paramsJson = JSON.stringify(params || {});
  const timeoutMs = Math.max(
    30_000,
    Number(process.env.AR_MESH_RUN_RECIPE_TIMEOUT_MS || 180_000) || 180_000,
  );
  const { bin, prefixArgs } = launch;

  if (!launchIsRunnable(launch)) {
    return Promise.reject(
      new Error(
        `Python indisponível (${bin}). Remova AR_MESH_PYTHON inválido no Railway ou use python3.`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(
      bin,
      [...prefixArgs, RUN_RECIPE_SCRIPT, recipe, inp, out, paramsJson],
      {
        cwd: path.dirname(RUN_RECIPE_SCRIPT),
        env: {
          ...process.env,
          PYTHONPATH: path.dirname(RUN_RECIPE_SCRIPT),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    proc.stderr?.on("data", (c) => {
      stderr += String(c);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`run_recipe timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `run_recipe exit ${code}: ${stderr.slice(-1200) || "(sem stderr)"}`,
          ),
        );
      }
    });
  });
}

function usePythonRunRecipe() {
  return /^(1|true|yes|on)$/i.test(
    String(process.env.AR_MESH_NODE_RUN_RECIPE_PYTHON || "").trim(),
  );
}

async function postprocessGlassesCanonicalNode(glbBuf, params) {
  try {
    const outBuf = await postprocessGlassesCanonicalNodeBuffer(glbBuf, params);
    console.log("[ar-eyewear] glasses_canonical via Node (gltf-transform + split lens)", {
      target_width_m: params.target_width_m,
      lens_type: params.lens_type,
    });
    return outBuf;
  } catch (nodeErr) {
    const allowLegacy = /^(1|true|yes|on)$/i.test(
      String(process.env.AR_MESH_RUN_RECIPE_FALLBACK || "").trim(),
    );
    if (!allowLegacy) throw nodeErr;
    console.warn(
      "[ar-eyewear] glasses_canonical Node falhou — canonicalize legado:",
      nodeErr?.message || nodeErr,
    );
    return canonicalizeArEyewearGlbBuffer(glbBuf);
  }
}

async function postprocessViaPythonRunRecipe(glbBuf, recipe, params) {
  const pyProbe = probePythonForRunRecipe();
  if (!pyProbe.ok || !pyProbe.launch) {
    throw new Error(`run_recipe indisponível (${recipe}): ${pyProbe.message}`);
  }

  const tmp = await mkdtemp(path.join(tmpdir(), "omafit-glasses-pp-"));
  const inp = path.join(tmp, "rodin_raw.glb");
  const out = path.join(tmp, "canonical.glb");
  try {
    await writeFile(inp, glbBuf);
    await runRecipeSubprocess(pyProbe.launch, recipe, inp, out, params);
    const outBuf = await readFile(out);
    if (outBuf.length < 1000) throw new Error("GLB pós-processado inválido (muito pequeno)");
    console.log("[ar-eyewear] glasses_canonical via run_recipe.py", {
      recipe,
      target_width_m: params.target_width_m,
      lens_type: params.lens_type,
    });
    return Buffer.from(outBuf);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {Buffer} glbBuf
 * @param {{ recipe?: string, params?: Record<string, unknown> }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function postprocessRodinGlassesGlbBuffer(glbBuf, opts = {}) {
  const recipe = String(opts.recipe || "glasses_canonical").trim() || "glasses_canonical";
  const params = opts.params && typeof opts.params === "object" ? opts.params : {};

  if (recipe === "glasses_canonical") {
    try {
      return await postprocessGlassesCanonicalNode(glbBuf, params);
    } catch (nodeErr) {
      if (!usePythonRunRecipe()) throw nodeErr;
      try {
        return await postprocessViaPythonRunRecipe(glbBuf, recipe, params);
      } catch (pyErr) {
        console.warn(
          "[ar-eyewear] run_recipe.py falhou após Node — rejeitando:",
          pyErr?.message || pyErr,
        );
        throw nodeErr;
      }
    }
  }

  return postprocessViaPythonRunRecipe(glbBuf, recipe, params);
}
