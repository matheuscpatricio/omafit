/**
 * Pós-processo óculos no Node — mesma receita que o worker `ar-mesh-generate`
 * (`run_recipe.py glasses_canonical`). Evita divergência de rotação/escala entre
 * `AR_MESH_WORKER_EXTERNAL=0` (Rodin no Node) e fila Python.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeArEyewearGlbBuffer } from "./ar-eyewear-glb-canonicalize.server.js";
import {
  logPythonProbeOnce,
  probePythonForRunRecipe,
  resolvePythonLaunch,
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
 * @param {string} bin
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
      const hint =
        err?.code === "ENOENT"
          ? ` Python não encontrado (${bin}). Instale Python 3 + trimesh ou defina AR_MESH_PYTHON. Em produção (Docker), redeploy com imagem que inclui python3.`
          : "";
      reject(new Error(`${err?.message || err}${hint}`));
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

/**
 * @param {Buffer} glbBuf
 * @param {{
 *   recipe?: string,
 *   params?: Record<string, unknown>,
 * }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function postprocessRodinGlassesGlbBuffer(glbBuf, opts = {}) {
  const recipe = String(opts.recipe || "glasses_canonical").trim() || "glasses_canonical";
  const params = opts.params && typeof opts.params === "object" ? opts.params : {};
  const useSubprocess =
    !/^(0|false|no)$/i.test(String(process.env.AR_MESH_NODE_RUN_RECIPE || "1").trim());

  if (useSubprocess) {
    const pyProbe = probePythonForRunRecipe();
    if (!pyProbe.ok) {
      const allowFallback = /^(1|true|yes|on)$/i.test(
        String(process.env.AR_MESH_RUN_RECIPE_FALLBACK || "").trim(),
      );
      if (!allowFallback) {
        throw new Error(
          `run_recipe indisponível (${recipe}): ${pyProbe.message}. ` +
            "Redeploy Railway (Dockerfile com venv) ou defina AR_MESH_PYTHON. " +
            "AR_MESH_RUN_RECIPE_FALLBACK=1 usa canonicalize legado (sem split lens_glass).",
        );
      }
    }
    const tmp = await mkdtemp(path.join(tmpdir(), "omafit-glasses-pp-"));
    const inp = path.join(tmp, "rodin_raw.glb");
    const out = path.join(tmp, "canonical.glb");
    try {
      await writeFile(inp, glbBuf);
      await runRecipeSubprocess(resolvePythonLaunch(), recipe, inp, out, params);
      const outBuf = await readFile(out);
      if (outBuf.length < 1000) throw new Error("GLB pós-processado inválido (muito pequeno)");
      console.log("[ar-eyewear] glasses_canonical via run_recipe.py (paridade worker)", {
        recipe,
        target_width_m: params.target_width_m,
        lens_type: params.lens_type,
      });
      return Buffer.from(outBuf);
    } catch (e) {
      const allowFallback = /^(1|true|yes|on)$/i.test(
        String(process.env.AR_MESH_RUN_RECIPE_FALLBACK || "").trim(),
      );
      if (!allowFallback) {
        throw new Error(
          `run_recipe falhou (${recipe}): ${e?.message || e}. ` +
            "Defina AR_MESH_RUN_RECIPE_FALLBACK=1 para canonicalize legado (sem split lens_glass).",
        );
      }
      console.warn(
        "[ar-eyewear] run_recipe falhou — fallback canonicalizeArEyewearGlbBuffer:",
        e?.message || e,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  return canonicalizeArEyewearGlbBuffer(glbBuf);
}
