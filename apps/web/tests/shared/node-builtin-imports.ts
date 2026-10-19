const NODE_SPECIFIER = /['"]node:[^'"]+['"]/;

const NODE_IMPORT_PATTERNS = [
  /\bfrom\s+['"]node:[^'"]+['"]/,
  /\bimport\s+['"]node:[^'"]+['"]/,
  /\bexport\s+[^;]*\sfrom\s+['"]node:[^'"]+['"]/,
  /\bimport\s*\(\s*['"]node:[^'"]+['"]\s*\)/,
  /\brequire\s*\(\s*['"]node:[^'"]+['"]\s*\)/,
];

export function sourceImportsNodeBuiltin(source: string) {
  if (!NODE_SPECIFIER.test(source)) return false;
  return NODE_IMPORT_PATTERNS.some((pattern) => pattern.test(source));
}
