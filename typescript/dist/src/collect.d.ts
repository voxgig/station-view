export type Source = 'telemetry' | 'debug' | 'audit' | 'station';
export type TrafficRecord = {
    seq: number;
    t: number;
    source: Source;
    kind: string;
    sdk?: string;
    api?: string;
    op?: string;
    method?: string;
    path?: string;
    status?: number;
    ok?: boolean;
    ms?: number;
    detail: any;
    run?: string;
    pid?: number;
};
export type Filter = {
    source?: string;
    sdk?: string;
    op?: string;
    status?: string;
    since?: number;
    limit?: number;
};
export type Watched = {
    name?: string;
    api?: string;
};
export type Collector = {
    add(source: Source, from: Watched, raw: any): TrafficRecord;
    station(ev: any): TrafficRecord;
    logged(line: any): TrafficRecord | undefined;
    records(filter?: Filter): TrafficRecord[];
    subscribe(fn: (rec: TrafficRecord) => void): () => void;
    dropped(): number;
};
export declare function makecollector(max?: number): Collector;
export declare function select(records: TrafficRecord[], filter: Filter): TrafficRecord[];
