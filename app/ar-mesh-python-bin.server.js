import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** @type {{ bin: string, prefixArgs: string[] } | null} */
let cachedPythonLaunch = null;

/**
 * @param {string} bin
 * @param {string[]} [prefixArgs]
 * @returns {boolean}
 */
function pythonLaunchWorks(bin, prefixArgs = []) {
  if (!bin) return false;
  if (!bin.includes("/") && !bin.includes("\\") && process.platform !== "win32") {
    /* spawn ENOENT se o binário não estiver no PATH */
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
    if (out && pythonLaunchWorks(out, [])) {
      return { bin: out, prefixArgs: [] };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Binário + args prefixo para `spawn` (ex.: `py -3` no Windows).
 * @returns {{ bin: string, prefixArgs: string[] }}
 */
export function resolvePythonLaunch() {
  if (cachedPythonLaunch) return cachedPythonLaunch;

  const override = String(process.env.AR_MESH_PYTHON || "").trim();
  if (override) {
    if (/^py(\s|$|-)/i.test(override) || override === "py") {
      const parts = override.split(/\s+/).filter(Boolean);
      const bin = parts[0] || "py";
      const prefixArgs = parts.slice(1);
      if (!prefixArgs.includes("-3") && !prefixArgs.some((p) => /^-3/.test(p))) {
        prefixArgs.unshift("-3");
      }
      cachedPythonLaunch = { bin, prefixArgs };
      return cachedPythonLaunch;
    }
    cachedPythonLaunch = { bin: override, prefixArgs: [] };
    return cachedPythonLaunch;
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
    candidates.push(
      { bin: "/opt/ar-mesh-venv/bin/python3", prefixArgs: [] },
      { bin: "/opt/ar-mesh-venv/bin/python", prefixArgs: [] },
      { bin: "/usr/bin/python3", prefixArgs: [] },
      { bin: "/usr/local/bin/python3", prefixArgs: [] },
      { bin: "python3", prefixArgs: [] },
      { bin: "/usr/bin/python", prefixArgs: [] },
      { bin: "python", prefixArgs: [] },
    );
    const fromShell = findPythonViaShell();
    if (fromShell) candidates.unshift(fromShell);
  }

  for (const c of candidates) {
    if (c.bin.includes("/") || c.bin.includes("\\")) {
      if (!existsSync(c.bin)) continue;
    }
    if (!pythonLaunchWorks(c.bin, c.prefixArgs)) continue;
    cachedPythonLaunch = c;
    return cachedPythonLaunch;
  }

  cachedPythonLaunch =
    process.platform === "win32"
      ? { bin: "python", prefixArgs: [] }
      : { bin: "/usr/bin/python3", prefixArgs: [] };
  return cachedPythonLaunch;
}

/** @returns {string} */
export function resolvePythonBin() {
  return resolvePythonLaunch().bin;
}

/**
 * Verifica Python + trimesh antes de `run_recipe.py` (log único no arranque / 1.º job).
 * @returns {{ ok: boolean, launch: { bin: string, prefixArgs: string[] }, trimesh: boolean, message: string }}
 */
export function probePythonForRunRecipe() {
  const launch = resolvePythonLaunch();
  const pyOk = pythonLaunchWorks(launch.bin, launch.prefixArgs);
  const triOk = pyOk && trimeshImportWorks(launch.bin, launch.prefixArgs);
  if (!pyOk) {
    return {
      ok: false,
      launch,
      trimesh: false,
      message: `Python indisponível (${launch.bin}). Defina AR_MESH_PYTHON ou redeploy Docker com venv.`,
    };
  }
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
