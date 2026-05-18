import { describe, expect, test } from "vitest";
import { parseCsv } from "@/lib/social/bulk-csv/parse";

const HEADER = "Content,Date,Time,Channel\n";

describe("parseCsv — happy path", () => {
  test("parses a minimal valid CSV", () => {
    const input = HEADER + '"Hello world",05/21/2026,09:00,LinkedIn';
    const { rows, errors } = parseCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Hello world");
    expect(rows[0].date).toBe("2026-05-21");
    expect(rows[0].time).toBe("09:00");
    expect(rows[0].channels).toEqual(["linkedin"]);
  });

  test("empty channel defaults to all (empty array)", () => {
    const input = HEADER + '"Post",05/22/2026,14:00,';
    const { rows, errors } = parseCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows[0].channels).toEqual([]);
  });

  test("pipe-separated channels", () => {
    const input = HEADER + '"Multi",05/23/2026,10:00,LinkedIn|Facebook';
    const { rows } = parseCsv(input);
    expect(rows[0].channels).toEqual(["linkedin", "facebook"]);
  });

  test("multiple data rows all pass", () => {
    const csv =
      HEADER +
      '"Row 1",05/21/2026,09:00,\n' +
      '"Row 2",05/22/2026,10:00,X\n' +
      '"Row 3",05/23/2026,11:00,Instagram';
    const { rows, errors } = parseCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
  });
});

describe("parseCsv — validation errors", () => {
  test("missing content", () => {
    const input = HEADER + ',05/21/2026,09:00,LinkedIn';
    const { errors } = parseCsv(input);
    expect(errors.some((e) => e.column === "Content")).toBe(true);
  });

  test("invalid date format", () => {
    const input = HEADER + '"Post",2026-05-21,09:00,';
    const { errors } = parseCsv(input);
    expect(errors.some((e) => e.column === "Date")).toBe(true);
  });

  test("invalid time format", () => {
    const input = HEADER + '"Post",05/21/2026,9am,';
    const { errors } = parseCsv(input);
    expect(errors.some((e) => e.column === "Time")).toBe(true);
  });

  test("unknown channel", () => {
    const input = HEADER + '"Post",05/21/2026,09:00,TikTokUnknown';
    const { errors } = parseCsv(input);
    expect(errors.some((e) => e.column === "Channel")).toBe(true);
  });

  test("row limit exceeded", () => {
    const rows = Array.from({ length: 101 }, (_, i) => `"Post ${i}",05/21/2026,09:00,`).join("\n");
    const { errors } = parseCsv(HEADER + rows);
    expect(errors.some((e) => e.message.includes("100-row limit"))).toBe(true);
  });

  test("empty file", () => {
    const { errors } = parseCsv("");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("errors do not include valid rows — invalid row excluded from rows array", () => {
    const input =
      HEADER +
      '"Valid",05/21/2026,09:00,LinkedIn\n' +
      ',05/22/2026,09:00,'; // missing content
    const { rows, errors } = parseCsv(input);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(rows).toHaveLength(1);
  });
});
