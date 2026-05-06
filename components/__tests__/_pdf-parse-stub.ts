export class PDFParse {
  constructor(_opts: unknown) {}
  getText(): Promise<{ text: string }> {
    return Promise.resolve({ text: "" });
  }
}
