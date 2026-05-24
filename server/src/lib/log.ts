export const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
export type LogLevelName = keyof typeof LOG_LEVELS;

let logLevel: number = LOG_LEVELS.info;
let accessLogOn = true;

export function configureLogging(levelName: string, accessLog: boolean | string) {
  logLevel = LOG_LEVELS[(levelName.toLowerCase() as LogLevelName)] ?? LOG_LEVELS.info;
  accessLogOn = accessLog !== "0" && accessLog !== false && logLevel >= LOG_LEVELS.info;
}

export const log = {
  error: (...a: unknown[]) => {
    if (logLevel >= LOG_LEVELS.error) console.error(...a);
  },
  warn: (...a: unknown[]) => {
    if (logLevel >= LOG_LEVELS.warn) console.warn(...a);
  },
  info: (...a: unknown[]) => {
    if (logLevel >= LOG_LEVELS.info) console.log(...a);
  },
  debug: (...a: unknown[]) => {
    if (logLevel >= LOG_LEVELS.debug) console.log(...a);
  },
  access: (...a: unknown[]) => {
    if (accessLogOn) console.log(...a);
  },
};

export function isAccessLogOn(): boolean {
  return accessLogOn;
}
