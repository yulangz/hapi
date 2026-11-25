import { join } from 'path'
import { tmpdir } from 'os'

export const HAMLET_BLOBS_DIR_NAME = 'hamlet-blobs'

export function getHamletBlobsDir(): string {
    return join(tmpdir(), HAMLET_BLOBS_DIR_NAME)
}
