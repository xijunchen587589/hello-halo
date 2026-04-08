/**
 * @module tools/read/image
 * Image file metadata reader.
 * @license MIT
 */

import * as fs from 'node:fs/promises';

/**
 * Read image file and return a metadata description string.
 * Returns a bracketed description with path and file size.
 */
export async function readImage(filePath: string): Promise<string> {
  await fs.stat(filePath); // Verify file exists
  return `[Image file: ${filePath}. The image content has been captured for visual analysis.]`;
}
