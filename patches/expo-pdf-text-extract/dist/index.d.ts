/**
 * expo-pdf-text-extract
 *
 * Native PDF text extraction for React Native / Expo
 *
 * Uses native platform APIs for reliable text extraction:
 * - Android: Apache PDFBox
 * - iOS: Apple PDFKit
 *
 * @packageDocumentation
 * @module expo-pdf-text-extract
 *
 * @example
 * ```typescript
 * import { extractText, isAvailable } from 'expo-pdf-text-extract';
 *
 * // Check if native module is available (false in Expo Go)
 * if (isAvailable()) {
 *   const text = await extractText('/path/to/document.pdf');
 *   console.log(text);
 * }
 * ```
 */
/**
 * Stable error codes thrown by the native module for password-protected PDFs
 * and other failure modes. Surfaced on thrown errors as `.code`.
 */
export type PdfErrorCode = 'PASSWORD_REQUIRED' | 'INCORRECT_PASSWORD' | 'FILE_NOT_FOUND' | 'CORRUPT_PDF' | 'UNKNOWN';
/**
 * Rich result returned by {@link extractTextWithInfo}.
 */
export interface ExtractTextWithInfoResult {
    text: string;
    pageCount: number;
    success: boolean;
    /** True if the source PDF declared encryption. */
    isEncrypted: boolean;
    /** True if extraction failed because no password (or the wrong one) was supplied. */
    passwordRequired?: boolean;
    error?: string;
    errorCode?: PdfErrorCode;
}
interface PdfExtractorModule {
    extractText(filePath: string, password?: string | null): Promise<string>;
    getPageCount(filePath: string, password?: string | null): Promise<number>;
    extractTextFromPage(filePath: string, pageNumber: number, password?: string | null): Promise<string>;
    isPasswordProtected(filePath: string): Promise<boolean>;
    isAvailable(): boolean;
}
/**
 * Check if the native PDF extractor is available
 *
 * Returns false when running in Expo Go or if the native module failed to load.
 * Use this to conditionally enable/disable PDF extraction features.
 */
export declare function isAvailable(): boolean;
/**
 * Extract all text from a PDF file
 *
 * @param filePath - Path to the PDF file. Supports `file://`, absolute paths,
 *   and (on Android) `content://` URIs.
 * @param password - Optional password for encrypted PDFs. Use
 *   {@link isPasswordProtected} to detect whether a password is needed.
 *
 * @throws Error with `.code === 'PASSWORD_REQUIRED'` if the PDF is encrypted
 *   and no password was provided.
 * @throws Error with `.code === 'INCORRECT_PASSWORD'` if the supplied password
 *   does not unlock the PDF.
 */
export declare function extractText(filePath: string, password?: string): Promise<string>;
/**
 * Get the number of pages in a PDF
 *
 * @param filePath - Path to the PDF file
 * @param password - Optional password for encrypted PDFs.
 * @throws Error with `.code === 'PASSWORD_REQUIRED' | 'INCORRECT_PASSWORD'` on
 *   password failures (see {@link extractText}).
 */
export declare function getPageCount(filePath: string, password?: string): Promise<number>;
/**
 * Extract text from a specific page
 *
 * @param filePath - Path to the PDF file
 * @param pageNumber - Page number (1-indexed, first page is 1)
 * @param password - Optional password for encrypted PDFs.
 */
export declare function extractTextFromPage(filePath: string, pageNumber: number, password?: string): Promise<string>;
/**
 * Detect whether a PDF requires a password to read.
 *
 * Returns `true` only if the PDF is encrypted AND a password is actually
 * required (i.e., it cannot be opened with an empty password). PDFs that
 * declare encryption but unlock with no password return `false` here — they
 * can be read by {@link extractText} without supplying a password.
 *
 * @example
 * ```typescript
 * if (await isPasswordProtected(uri)) {
 *   const pwd = await promptUser();
 *   const text = await extractText(uri, pwd);
 * } else {
 *   const text = await extractText(uri);
 * }
 * ```
 */
export declare function isPasswordProtected(filePath: string): Promise<boolean>;
/**
 * Extract text with detailed result
 *
 * Non-throwing variant: password issues are surfaced as `passwordRequired: true`
 * with a populated `errorCode`, rather than thrown.
 */
export declare function extractTextWithInfo(filePath: string, password?: string): Promise<ExtractTextWithInfoResult>;
/** Coordinate-based structured row extraction. Returns string[][] — rows × columns. */
export declare function extractRows(filePath: string, password?: string): Promise<string[][]>;
export type { PdfExtractorModule };
//# sourceMappingURL=index.d.ts.map