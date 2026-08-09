/**
 * Splits markdown content into sections at each h1-h3 heading, so header
 * text and its body travel together as one editable/diffable unit.
 */
export function splitIntoSections(content: string): string[] {
  const parsed = content.split(/(?=^#{1,3} )/m).filter((s) => s.trim().length > 0);
  return parsed.length > 0 ? parsed : [content];
}
