export class WorkflowEntrypoint<E> {
  protected env: E;
  constructor(_context: unknown, env: E) {
    this.env = env;
  }
}
export class NonRetryableError extends Error {}
export class DurableObject<E> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: E,
  ) {}
}
