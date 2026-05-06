export class PDFParse {
  constructor(_opts: { data: Uint8Array }) {}
  async getText(): Promise<{ text: string }> {
    return { text: "" };
  }
}
