/**
 * Omafit — auditoria de segurança: dependências (npm), padrões sensíveis no repo
 * e, opcionalmente, Supabase Security Advisors (Management API).
 *
 * Uso:
 *   node scripts/security-audit.mjs
 *   node scripts/security-audit.mjs --no-supabase   # só repositório + npm
 *
 * Supabase (opcional):
 *   export SUPABASE_ACCESS_TOKEN="sbp_…"  # personal access token (dashboard)
 *   export SUPABASE_PROJECT_REF="abcd…"  # project ref (URL *.supabase.co)
 *
 * Falha o processo (exit 1) se:
 *   - npm audit ultrapassar o nível definido (AUDIT_MIN_LEVEL, padrão: critical
 *     — use `high` ou `moderate` no CI para exigir correção);
 *   - forem encontrados padrões críticos no repositório (chaves, tokens);
 *   - a API de advisors do Supabase retornar lints de nível ERROR.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MAX_FILE_BYTES = 500 * 1024;
const AUDIT_LEVELS = ['low', 'moderate', 'high', 'critical'];
const args = new Set(process.argv.slice(2));
const skipSupabase = args.has('--no-supabase') || process.env.SECURITY_SKIP_SUPABASE === '1';

function logSection(title) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

function getAuditMinIndex() {
  const raw = (process.env.AUDIT_MIN_LEVEL || 'critical').toLowerCase();
  const i = AUDIT_LEVELS.indexOf(raw);
  if (i === -1) {
    console.error(`AUDIT_MIN_LEVEL inválido: use um de: ${AUDIT_LEVELS.join(', ')}`);
    process.exit(2);
  }
  return i;
}

function runNpmAudit() {
  logSection('1. Dependências (npm audit)');
  const minIndex = getAuditMinIndex();
  const result = spawnSync('npm', ['audit', '--json', '--audit-level=low'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  // npm retorna 1 com vulnerabilidades, mas ainda emite JSON em stdout
  const out = (result.stdout || '').trim() || (result.stderr || '').trim();
  let data;
  try {
    data = JSON.parse(out);
  } catch {
    console.error('Não foi possível interpretar a saída do npm audit.');
    console.error(out.slice(0, 2000));
    process.exit(1);
  }

  const meta = data.metadata?.vulnerabilities;
  if (meta) {
    const { info = 0, low = 0, moderate = 0, high = 0, critical = 0, total = 0 } = meta;
    console.log(
      `Resumo: total=${total}  critical=${critical}  high=${high}  moderate=${moderate}  low=${low}  info=${info}`
    );
  } else if (data.error) {
    console.error('npm audit retornou erro:', data.error.detail || data.error);
    process.exit(1);
  }

  let shouldFail = false;
  for (const level of AUDIT_LEVELS) {
    const idx = AUDIT_LEVELS.indexOf(level);
    const n = data.metadata?.vulnerabilities?.[level] ?? 0;
    if (n > 0 && idx >= minIndex) {
      shouldFail = true;
    }
  }

  if (shouldFail) {
    const threshold = AUDIT_LEVELS[minIndex];
    console.error(
      `\nFalha: existem vulnerabilidades em ${threshold} ou acima (mínimo configurado: ${threshold}).`
    );
    console.error('Corrija com `npm audit fix` ou avalie o relatório: `npm audit`');
    process.exit(1);
  }

  console.log('OK — npm audit dentro do limite configurado.');
}

function getTrackedFiles() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024
  });
  const list = [];
  for (const chunk of out.toString('binary').split('\0')) {
    if (chunk) list.push(chunk);
  }
  return list;
}

const CRITICAL_PATTERNS = [
  { name: 'chave privada (PEM/SSH)', re: /BEGIN (?:OPENSSH|RSA|EC|DSA) ?(?:PRIVATE) ?KEY/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'token Stripe (live)', re: /sk_live_[0-9a-zA-Z]{20,}/ },
  { name: 'Shopify admin token (shpat_)', re: /shpat_[a-f0-9]{32}/i },
  { name: 'GitHub PAT (classic)', re: /ghp_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ }
];

const WARN_PATTERNS = [
  { name: 'possível JWT/secret em linha (eyJ...)', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'variável de service role do Supabase', re: /SUPABASE_SERVICE_ROLE|service_role_key/i }
];

function scanRepository() {
  logSection('2. Repositório (padrões de segredo / vazamento)');
  const files = getTrackedFiles();
  const extSkip = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.lock', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.zip', '.glb', '.gltf']);
  let criticalHits = 0;
  const warnList = [];

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (extSkip.has(ext) || rel.includes('package-lock.json')) {
      continue;
    }
    const full = path.join(REPO_ROOT, rel);
    let buf;
    try {
      buf = readFileSync(full);
    } catch {
      continue;
    }
    if (buf.length > MAX_FILE_BYTES) {
      continue;
    }
    const isBinary = buf.includes(0);
    if (isBinary) {
      continue;
    }
    const text = buf.toString('utf8', 0, Math.min(buf.length, MAX_FILE_BYTES));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { name, re } of CRITICAL_PATTERNS) {
        if (re.test(line)) {
          console.error(`[CRITICAL] ${name}\n  ${rel}:${i + 1}  ${line.trim().slice(0, 120)}…`);
          criticalHits++;
        }
      }
      for (const { name, re } of WARN_PATTERNS) {
        if (re.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('#')) {
          warnList.push({ name, file: rel, line: i + 1, preview: line.trim().slice(0, 100) });
        }
      }
    }
  }

  for (const w of warnList.slice(0, 30)) {
    console.warn(
      `[WARN] ${w.name} — ${w.file}:${w.line}\n  ${w.preview}${w.preview.length >= 100 ? '…' : ''}`
    );
  }
  if (warnList.length > 30) {
    console.warn(`… e mais ${warnList.length - 30} avisos.`);
  }

  if (criticalHits > 0) {
    console.error(`\nFalha: ${criticalHits} ocorrência(s) crítica(s) (remova chaves e tokens reais do histórico).`);
    process.exit(1);
  }
  if (warnList.length === 0) {
    console.log('Nenhum padrão suspeito (warn) encontrado além de verificações críticas.');
  } else {
    console.log('Avisos listados; revise manualmente. O job não falha por avisos (apenas crítico).');
  }
  console.log('OK — varredura de repositório (crítico).');
}

async function fetchSupabaseSecurityAdvisors() {
  logSection('3. Supabase (Security Advisors via API)');
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!token || !projectRef) {
    console.log(
      'Ignorado: defina SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF para consultar o projeto remoto.\n' +
        '(Token em https://supabase.com/dashboard/account/tokens  —  ref = identificador do subdomínio *.supabase.co)'
    );
    return;
  }
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/advisors/security`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`Falha HTTP ${res.status} ao chamar ${url}\n${t.slice(0, 1500)}`);
    process.exit(1);
  }
  const body = await res.json();
  const lints = body.lints || body || [];
  if (!Array.isArray(lints)) {
    console.log('Resposta inesperada:', JSON.stringify(body, null, 0).slice(0, 500));
    return;
  }
  if (lints.length === 0) {
    console.log('Nenhum aviso de segurança ativo (lints vazio).');
    return;
  }

  const errors = [];
  for (const l of lints) {
    const level = l.level || 'INFO';
    const title = l.title || l.name || 'lint';
    const detail = (l.detail || l.description || '').trim();
    const rem = l.remediation ? ` Remediação: ${l.remediation}` : '';
    console.log(`- [${level}] ${title}: ${detail}${rem}`);
    if (String(level).toUpperCase() === 'ERROR') {
      errors.push(l);
    }
  }
  if (errors.length > 0) {
    console.error(
      `\nFalha: ${errors.length} lints de nível ERROR nos Security Advisors do Supabase. Corrija no SQL Editor / dashboard.`
    );
    process.exit(1);
  }
  console.log('OK — sem lints ERROR nos advisors de segurança.');
}

async function main() {
  process.chdir(REPO_ROOT);
  runNpmAudit();
  scanRepository();
  if (!skipSupabase) {
    await fetchSupabaseSecurityAdvisors();
  } else {
    logSection('3. Supabase');
    console.log('Ignorado (--no-supabase / SECURITY_SKIP_SUPABASE).');
  }
  console.log(`\n${'='.repeat(64)}\n  Auditoria concluída com sucesso.\n${'='.repeat(64)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
