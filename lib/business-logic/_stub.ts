// Stage 2 scaffolding: thrown by every engine function until it is implemented (P08–P10).
export function notImplemented(name: string): never {
  throw new Error(`not implemented: ${name}`);
}
