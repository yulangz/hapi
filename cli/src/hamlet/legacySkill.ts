import { createHash } from 'node:crypto'
import { readFile, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

// Only retire the unmodified SKILL.md installed by the previous Runner.
const legacyDigest = 'f3830af3560c0b49dd66411b370649573613957fd47343a7b268f040672dba38'

export async function removeLegacyManagedSkill(codexHome: string) {
    const directory = join(codexHome, 'skills', 'hamlet-agent')
    const target = join(directory, 'SKILL.md')
    try {
        const contents = await readFile(target)
        if (createHash('sha256').update(contents).digest('hex') === legacyDigest) {
            await rm(target, { force: true })
            await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error
            })
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
}
