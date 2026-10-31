/**
 * Sanitize a user-supplied string before inserting into the OpenAI prompt.
 * Removes null bytes and non-printable control characters, and truncates to maxLength.
 */
export function sanitizeInput(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code > 31 && code !== 127;
    })
    .join("")
    .slice(0, maxLength)
    .trim();
}
