import type { Listening } from './server';
export type ServeLogOptions = {
    log?: string;
    port?: number;
    host?: string;
    max?: number;
    every?: number;
};
export declare function servelog(opts?: ServeLogOptions): Promise<Listening & {
    log: string;
}>;
export declare function main(argv: string[]): Promise<void>;
