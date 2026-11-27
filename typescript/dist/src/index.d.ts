import { select } from './collect';
import type { Filter, Source, TrafficRecord } from './collect';
import { defaultlog, followlog, logpath, readlog } from './log';
import type { Listening, ListenOptions } from './server';
export { defaultlog, followlog, logpath, readlog, select };
export { servelog } from './cli';
export type { ServeLogOptions } from './cli';
export type { Filter, Listening, ListenOptions, Source, TrafficRecord };
export type StationLike = {
    status(): {
        mode: string;
        profile: string;
        events: {
            buffered: number;
            dropped: number;
        };
    };
    instances(): {
        name: string;
        api: string;
        active: boolean;
    }[];
    events(): any[];
    tap(fn: (ev: any) => void): () => void;
    redact(text: string): string;
};
export type BoundSdk = {
    name: string;
    api: string;
    descriptor: any;
    client: any;
};
export type ViewOptions = {
    max?: number;
    features?: string[];
    log?: string | boolean;
    logMax?: number;
};
export type View = {
    records(filter?: Filter): TrafficRecord[];
    sdks(): {
        name: string;
        api: string;
        metrics: any;
    }[];
    snapshot(): {
        mode: string;
        profile: string;
        instances: {
            name: string;
            api: string;
            active: boolean;
        }[];
        records: number;
        dropped: number;
    };
    listen(opts?: ListenOptions): Promise<Listening>;
    follow(): () => void;
    logfile(): string | undefined;
};
export declare function makeview(station: StationLike, options?: ViewOptions): View & {
    watch(feature: any, info: any): any;
    bound(sdk: BoundSdk): void;
};
export declare const StationView: {
    name: string;
    define(inst: any): void;
    activate(inst: any): void;
};
