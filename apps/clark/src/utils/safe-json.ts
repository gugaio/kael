export function safeJsonParse(input: string): unknown {
  return JSON.parse(input) as unknown;
}

export function safeJsonStringify(input: unknown): string {
  return JSON.stringify(input);
}
