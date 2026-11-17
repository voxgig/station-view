import { select } from './collect';
import type { Filter, Source, TrafficRecord } from './collect';
import type { Listening, ListenOptions } from './server';
export { select };
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
