declare module 'bun:bundle' {
    interface Registry {
        features:
            | 'HAMLET_TARGET_DARWIN_ARM64'
            | 'HAMLET_TARGET_DARWIN_X64'
            | 'HAMLET_TARGET_LINUX_ARM64'
            | 'HAMLET_TARGET_LINUX_X64'
            | 'HAMLET_TARGET_WIN32_X64';
    }

    export function feature(name: Registry['features']): boolean;
}
