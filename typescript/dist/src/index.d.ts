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
    events(): {
        kind: string;
    }[];
};
export type ViewSnapshot = {
    stub: true;
    mode: string;
    profile: string;
    instances: {
        name: string;
        api: string;
        active: boolean;
    }[];
    events: {
        buffered: number;
        dropped: number;
        kinds: {
            [kind: string]: number;
        };
    };
};
export type View = {
    snapshot(): ViewSnapshot;
};
export declare function makeview(station: StationLike): View;
export declare const StationView: {
    name: string;
    activate(inst: any): void;
};
