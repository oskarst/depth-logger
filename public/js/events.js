// Tiny pub/sub so feature modules can announce changes without importing each
// other (which is what tangled the original single-file version).
const listeners = new Map();

export function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(handler);
  return () => listeners.get(name).delete(handler);
}

export function emit(name, detail) {
  for (const handler of listeners.get(name) || []) {
    try {
      handler(detail);
    } catch (e) {
      console.error(`listener for "${name}" failed`, e);
    }
  }
}
