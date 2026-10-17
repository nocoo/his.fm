export function e2eOrigin(): string {
  return new URL(process.env.HISFM_E2E_BASE_URL ?? 'https://hisfm.dev.hexly.ai').origin;
}
