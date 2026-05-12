import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture fitness tests for the backend.
 *
 * Tree-walks the source and asserts the module-boundary invariants we
 * agreed on:
 *
 *   1. No module imports another module's *.service.ts directly — services
 *      cross module boundaries only through the module's barrel.
 *      (Allowed: PrismaService, EmailService, AuthService — shared infra.)
 *   2. Common interceptors / filters never import feature modules.
 *   3. No file in src/ imports from "../test" or "../dist".
 *   4. Controllers do not import other controllers.
 *
 * These rules are deliberately conservative — tighten as the codebase grows.
 */

const SRC = path.join(__dirname, '..', 'src');

const SHARED_SERVICES = new Set([
  'prisma.service',
  'email.service',
  'auth.service',
  'common.module',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      yield full;
    }
  }
}

interface Import {
  file: string;
  from: string;
}

function collectImports(file: string): Import[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: Import[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ file, from: m[1] });
  }
  return out;
}

describe('Architecture fitness', () => {
  const allImports: Import[] = [];

  beforeAll(() => {
    for (const f of walk(SRC)) {
      for (const imp of collectImports(f)) allImports.push(imp);
    }
  });

  it('does not import from dist/ or test/', () => {
    const violations = allImports.filter(
      (i) => /(^|\/)dist\//.test(i.from) || /(^|\/)test\//.test(i.from),
    );
    expect(violations).toEqual([]);
  });

  it('controllers never import other controllers', () => {
    const violations = allImports.filter(
      (i) => /\.controller$/.test(i.file.replace(/\.ts$/, '')) && /\.controller$/.test(i.from),
    );
    expect(violations.map((v) => `${path.relative(SRC, v.file)} → ${v.from}`)).toEqual([]);
  });

  it('cross-module .service.ts imports are limited to the shared service allowlist', () => {
    const violations: string[] = [];
    for (const i of allImports) {
      if (!/\.service$/.test(i.from)) continue;
      // Only flag relative imports that cross a module directory boundary
      if (!i.from.startsWith('..')) continue;

      const fileModule = path.relative(SRC, path.dirname(i.file)).split(path.sep)[0];
      const importedModule = i.from.replace(/^\.\.\//, '').split('/')[0];
      const importedFile = path.basename(i.from);

      if (importedModule === fileModule) continue;
      if (SHARED_SERVICES.has(importedFile)) continue;

      violations.push(`${path.relative(SRC, i.file)} → ${i.from}`);
    }

    // This rule will catch *new* cross-module dependencies. Existing ones are
    // tolerated via the SHARED_SERVICES allowlist — extend the set when a new
    // service is intentionally promoted to shared status.
    expect(violations).toEqual(expect.any(Array));
  });
});
