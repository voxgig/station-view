import type { Filter, TrafficRecord } from './collect';
export type Feed = {
    records(filter?: Filter): TrafficRecord[];
    subscribe(fn: (rec: TrafficRecord) => void): () => void;
    sdks(): any[];
    redact(text: string): string;
};
export type Listening = {
    url: string;
    port: number;
    close(): Promise<void>;
};
export type ListenOptions = {
    port?: number;
    host?: string;
};
export declare function listen(feed: Feed, opts?: ListenOptions): Promise<Listening>;
