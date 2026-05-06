declare module "pdf-parse" {
  interface PDFParseOptions {
    data: Uint8Array;
  }
  interface PDFParseResult {
    text: string;
  }
  class PDFParse {
    constructor(options: PDFParseOptions);
    getText(): Promise<PDFParseResult>;
  }
  export { PDFParse };
}
