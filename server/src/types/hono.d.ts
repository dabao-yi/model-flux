import "hono";

declare module "hono" {
  interface ContextVariableMap {
    lockedProvider: string;
  }
}
