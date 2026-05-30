/**
 * parseSecondaryRuns — secondary style parser for the v2 template engine.
 *
 * Design spec §6.6, §1.7: text wrapped in *asterisks* renders with the
 * layer's `secondary` style. This parser must be identical across ALL
 * renderers (DOM editor canvas and sharp server renderer).
 *
 * This file is deliberately free of `server-only` and any server-side
 * imports so it can be used in client components (CanvasContent.tsx)
 * as well as the server-side sharp renderer (layer-renderer.ts).
 */

export interface TextRun {
  text: string;
  secondary: boolean;
}

/**
 * Split a text string into normal and secondary runs.
 * Text wrapped in *asterisks* is marked secondary: true.
 *
 * "Mindset Shifts That *Matter*" →
 *   [{text:"Mindset Shifts That ",secondary:false},{text:"Matter",secondary:true}]
 */
export function parseSecondaryRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /([^*]*)(?:\*([^*]*)\*)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) break;
    if (match[1]) runs.push({ text: match[1], secondary: false });
    if (match[2]) runs.push({ text: match[2], secondary: true });
  }
  return runs.filter((r) => r.text.length > 0);
}
