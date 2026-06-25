import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** @type {{ bin: string, prefixArgs: string[] } | null} */
let cachedPythonLaunch = null;

/**
 * Railway/Docker às vezes define AR_MESH_PYTHON=/opt/ar-mesh-venv/bin/python3 sem o venv existir.
 * Ignoramos o override inválido para não propagar ENOENT no spawn.
 */
function sanitizeArMeshPythonEnv() {
  const override = String(process.env.AR_MESH_PYTHON || "").trim();
  if (!override || override === "python3" || override === "python") return;
  if (!override.includes("/") && !override.includes("\\")) return;
  if (existsSync(override)) return;
  console.warn(
    `[ar-mesh] AR_MESH_PYTHON ignorado (ficheiro inexistente): ${override}`,
  );
  delete process.env.AR_MESH_PYTHON;
}

sanitizeArMeshPythonEnv();

/**
 * @param {string} bin
 * @param {string[]} [prefixArgs]
 * @returns {boolean}
 */
function pythonLaunchWorks(bin, prefixArgs = []) {
  if (!bin) return false;
  if ((bin.includes("/") || bin.includes("\\")) && !existsSync(bin)) {
    return false;
  }
  try {
    execFileSync(bin, [...prefixArgs, "-c", "import sys; sys.exit(0)"], {
      stdio: "ignore",
      timeout: 8000,
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} bin
 * @param {string[]} [prefixArgs]
 * @returns {boolean}
 */
function trimeshImportWorks(bin, prefixArgs = []) {
  try {
    execFileSync(
      bin,
      [...prefixArgs, "-c", "import trimesh, numpy; raise SystemExit(0)"],
      { stdio: "ignore", timeout: 15000, env: process.env },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ bin: string, prefixArgs: string[] }} launch
 * @returns {boolean}
 */
export function launchIsRunnable(launch) {
  return pythonLaunchWorks(launch?.bin, launch?.prefixArgs || []);
}

/**
 * @param {string} override
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
function parsePythonOverride(override) {
  const raw = String(override || "").trim();
  if (!raw) return null;
  if (/^py(\s|$|-)/i.test(raw) || raw === "py") {
    const parts = raw.split(/\s+/).filter(Boolean);
    const bin = parts[0] || "py";
    const prefixArgs = parts.slice(1);
    if (!prefixArgs.includes("-3") && !prefixArgs.some((p) => /^-3/.test(p))) {
      prefixArgs.unshift("-3");
    }
    return { bin, prefixArgs };
  }
  return { bin: raw, prefixArgs: [] };
}

/**
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
function findPythonViaShell() {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync(
      "sh",
      ["-c", "command -v python3 2>/dev/null || command -v python 2>/dev/null || true"],
      { encoding: "utf8", timeout: 5000, env: process.env },
    ).trim();
    if (out) {
      const launch = { bin: out, prefixArgs: [] };
      if (launchIsRunnable(launch)) return launch;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
function pickPythonLaunch() {
  const override = String(process.env.AR_MESH_PYTHON || "").trim();
  if (override) {
    const parsed = parsePythonOverride(override);
    if (parsed && launchIsRunnable(parsed)) return parsed;
    if (parsed) {
      console.warn(
        `[ar-mesh] AR_MESH_PYTHON=${override} indisponível — a tentar python do sistema`,
      );
    }
  }

  /** @type {{ bin: string, prefixArgs: string[] }[]} */
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push(
      { bin: "python", prefixArgs: [] },
      { bin: "py", prefixArgs: ["-3"] },
      { bin: "python3", prefixArgs: [] },
    );
  } else {
    const fromShell = findPythonViaShell();
    if (fromShell) candidates.push(fromShell);
    candidates.push(
      { bin: "/opt/ar-mesh-venv/bin/python3", prefixArgs: [] },
      { bin: "/opt/ar-mesh-venv/bin/python", prefixArgs: [] },
      { bin: "/usr/bin/python3", prefixArgs: [] },
      { bin: "/usr/local/bin/python3", prefixArgs: [] },
      { bin: "python3", prefixArgs: [] },
      { bin: "/usr/bin/python", prefixArgs: [] },
      { bin: "python", prefixArgs: [] },
    );
  }

  for (const c of candidates) {
    if (launchIsRunnable(c)) return c;
  }
  return null;
}

/**
 * Binário validado para `spawn`. Devolve `null` se não houver Python executável.
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
export function resolveRunnablePythonLaunch() {
  if (cachedPythonLaunch && launchIsRunnable(cachedPythonLaunch)) {
    return cachedPythonLaunch;
  }
  cachedPythonLaunch = pickPythonLaunch();
  return cachedPythonLaunch;
}

/**
 * @returns {{ bin: string, prefixArgs: string[] }}
 */
export function resolvePythonLaunch() {
  const launch = resolveRunnablePythonLaunch();
  if (launch) return launch;
  return process.platform === "win32"
    ? { bin: "python", prefixArgs: [] }
    : { bin: "python3", prefixArgs: [] };
}

/** @returns {string} */
export function resolvePythonBin() {
  return resolvePythonLaunch().bin;
}

/**
 * Verifica Python + trimesh antes de `run_recipe.py`.
 * @returns {{ ok: boolean, launch: { bin: string, prefixArgs: string[] } | null, trimesh: boolean, message: string }}
 */
export function probePythonForRunRecipe() {
  const launch = resolveRunnablePythonLaunch();
  if (!launch) {
    return {
      ok: false,
      launch: null,
      trimesh: false,
      message:
        "Python não encontrado. Remova AR_MESH_PYTHON=/opt/ar-mesh-venv/bin/python3 no Railway ou faça redeploy com Dockerfile.",
    };
  }
  const triOk = trimeshImportWorks(launch.bin, launch.prefixArgs);
  if (!triOk) {
    return {
      ok: false,
      launch,
      trimesh: false,
      message: `Python OK (${launch.bin}) mas trimesh/numpy em falta. pip install trimesh numpy`,
    };
  }
  return {
    ok: true,
    launch,
    trimesh: true,
    message: `run_recipe python=${launch.bin}`,
  };
}

let probeLogged = false;

/** Log once at startup (import side-effect safe). */
export function logPythonProbeOnce() {
  if (probeLogged) return;
  probeLogged = true;
  try {
    const p = probePythonForRunRecipe();
    if (p.ok) {
      console.log("[ar-mesh] run_recipe:", p.message);
    } else {
      console.warn("[ar-mesh] run_recipe indisponível:", p.message);
    }
  } catch (e) {
    console.warn("[ar-mesh] run_recipe probe:", e?.message || e);
  }
}
