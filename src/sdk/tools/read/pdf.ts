/**
 * @module tools/read/pdf
 * Basic PDF text extraction.
 * @license MIT
 */

/**
 * Read a PDF file and extract text content.
 * Full PDF support requires an external library (e.g. pdf-parse).
 * This is a placeholder that returns a helpful message.
 */
export async function readPdf(filePath: string, pages?: string): Promise<string> {
  // Full PDF text extraction requires an external library.
  // The host application can provide a real implementation via ToolContext.
  return (
    `[PDF file: ${filePath}. ` +
    (pages ? `Requested pages: ${pages}. ` : '') +
    'Use the `pages` parameter to read specific page ranges.]'
  );
}
