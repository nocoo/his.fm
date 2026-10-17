export const IMPORT_EXAMPLE_MARKER: string;

export function quote(value: unknown): string;

export function buildImportExampleStatements(
  production: Record<string, unknown>,
  options: { mode: '--local' | '--remote'; now: string; importWriteId: string },
): string[];

export function joinImportExampleSql(statements: string[]): string;

export function splitImportExampleCliSql(sql: string): string[];
