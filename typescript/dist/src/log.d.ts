import type { TrafficRecord } from './collect';
export declare const LOG_VERSION = 1;
export declare const MAX_LOG_BYTES: number;
export declare function defaultlog(): string;
export declare function logpath(option?: string | boolean, env?: {
    [key: string]: string | undefined;
}): string | undefined;
export type LogWriter = {
    path: string;
    run: string;
    write(rec: TrafficRecord): void;
};
export declare function makelog(path: string, redact: (text: string) => string, maxBytes?: number): LogWriter;
export declare function readlog(path: string, take: (rec: any) => void): void;
export declare function followlog(path: string, take: (rec: any) => void, every?: number): () => void;
