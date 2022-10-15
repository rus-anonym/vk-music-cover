export interface IConfig {
    fakes: string[];
    token: string;
    groupId: number;
    fallbackUsers?: number[];
}

const config: IConfig = {
    fakes: [],
    token: "",
    groupId: 0
};

export default config;
// Path: src/config.ts
