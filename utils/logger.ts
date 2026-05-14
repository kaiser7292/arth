/**
 * Centralized logger for Artha.
 *
 * - In development (`__DEV__` is true), logs to the console.
 * - In production builds, every method is a silent no-op so no
 *   user-facing noise or performance overhead remains.
 */

type LogLevel = "error" | "warn";
type ProductionLogHandler = (level: LogLevel, message: string, context?: object) => void;

let productionHandler: ProductionLogHandler | null = null;

export function attachProductionLogHandler(handler: ProductionLogHandler): void {
  productionHandler = handler;
}

function noop(_message: string, _context?: unknown): void {
  // intentionally empty
}

export const logger = {
  error: __DEV__
    ? (message: string, context?: unknown) => console.error(`[Artha] ${message}`, context)
    : noop,

  warn: __DEV__
    ? (message: string, context?: unknown) => console.warn(`[Artha] ${message}`, context)
    : noop,

  info: __DEV__
    ? (message: string, context?: unknown) => console.info(`[Artha] ${message}`, context)
    : noop,

  debug: __DEV__
    ? (message: string, context?: unknown) => console.debug(`[Artha] ${message}`, context)
    : noop,
};
