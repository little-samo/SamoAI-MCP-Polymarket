const CHARACTER_LIMIT = 25000;

export function formatResult(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      '\n\n... [truncated — use pagination or filters to narrow results]';
  }
  return {
    content: [{ type: 'text' as const, text }],
  };
}

export function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

export function requireAuth(isReadOnly: boolean): string | null {
  if (isReadOnly) {
    return 'This tool requires authentication. Set POLYMARKET_PRIVATE_KEY to enable trading.';
  }
  return null;
}
