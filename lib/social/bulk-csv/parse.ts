/**
 * Canonical CSV parser for composer bulk uploads and CAP automation.
 * Both /api/platform/social/drafts/bulk and CAP import from this module.
 *
 * CSV format:
 *   Content,Date,Time,Channel
 *   "Hello world",05/21/2026,09:00,LinkedIn
 *
 * Date: MM/DD/YYYY  Time: HH:MM (24h)  Channel: pipe-separated or empty (= all)
 */

export interface ParsedRow {
  content: string;
  date: string;      // YYYY-MM-DD normalised
  time: string;      // HH:MM
  channels: string[];
  rowIndex: number;  // 1-indexed (first data row = 1)
}

export interface ValidationError {
  row: number;
  column: "Content" | "Date" | "Time" | "Channel";
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ValidationError[];
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const VALID_CHANNELS = new Set(["linkedin", "facebook", "instagram", "x", "googlemybusiness"]);

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseCsv(input: string): ParseResult {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  const rows: ParsedRow[] = [];
  const errors: ValidationError[] = [];

  if (lines.length === 0) {
    return { rows, errors: [{ row: 0, column: "Content", message: "File is empty." }] };
  }

  // Skip header row (Content,Date,Time,Channel).
  const dataLines = lines.slice(1);

  if (dataLines.length > 100) {
    errors.push({ row: 0, column: "Content", message: "File exceeds 100-row limit." });
    return { rows, errors };
  }

  for (let i = 0; i < dataLines.length; i++) {
    const rowIndex = i + 1;
    const line = dataLines[i];
    const fields = parseCsvLine(line);
    const [content = "", dateRaw = "", timeRaw = "", channelRaw = ""] = fields;

    let hasError = false;

    if (!content) {
      errors.push({ row: rowIndex, column: "Content", message: "Content is required." });
      hasError = true;
    } else if (content.length > 63206) {
      errors.push({ row: rowIndex, column: "Content", message: "Content exceeds 63206 characters." });
      hasError = true;
    }

    let normalizedDate = "";
    const dateMatch = DATE_RE.exec(dateRaw);
    if (!dateMatch) {
      errors.push({ row: rowIndex, column: "Date", message: "Date must be MM/DD/YYYY." });
      hasError = true;
    } else {
      const [, mm, dd, yyyy] = dateMatch;
      const d = new Date(`${yyyy}-${mm}-${dd}`);
      if (isNaN(d.getTime())) {
        errors.push({ row: rowIndex, column: "Date", message: "Invalid date value." });
        hasError = true;
      } else {
        normalizedDate = `${yyyy}-${mm}-${dd}`;
        const todayDate = new Date();
        const todayNormalized = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
        if (normalizedDate < todayNormalized) {
          errors.push({ row: rowIndex, column: "Date", message: "Date must be today or in the future." });
          hasError = true;
        }
      }
    }

    const timeMatch = TIME_RE.exec(timeRaw);
    if (!timeMatch) {
      errors.push({ row: rowIndex, column: "Time", message: "Time must be HH:MM (24-hour)." });
      hasError = true;
    } else {
      const [, hh, min] = timeMatch;
      const h = parseInt(hh, 10);
      const m = parseInt(min, 10);
      if (h > 23 || m > 59) {
        errors.push({ row: rowIndex, column: "Time", message: "Invalid time value." });
        hasError = true;
      }
    }

    let channels: string[] = [];
    if (channelRaw) {
      channels = channelRaw.split("|").map((c) => c.trim().toLowerCase().replace(/\s/g, ""));
      for (const ch of channels) {
        if (!VALID_CHANNELS.has(ch)) {
          errors.push({
            row: rowIndex,
            column: "Channel",
            message: `Unknown channel "${ch}". Valid: LinkedIn, Facebook, Instagram, X, GoogleMyBusiness.`,
          });
          hasError = true;
          break;
        }
      }
    }

    if (!hasError) {
      rows.push({ content, date: normalizedDate, time: timeRaw, channels, rowIndex });
    }
  }

  return { rows, errors };
}
