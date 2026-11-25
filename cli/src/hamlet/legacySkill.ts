import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

// Only retire the unmodified SKILL.md installed by the previous Runner.
const legacyDigest = 'f3830af3560c0b49dd66411b370649573613957fd47343a7b268f040672dba38'

export async function removeLegacyManagedSkill(codexHome: string) {
    const target = join(codexHome, 'skills', 'hamlet-agent', 'SKILL.md')
    try {
        const contents = await readFile(target)
        if (createHash('sha256').update(contents).digest('hex') === legacyDigest) {
            await rm(target, { force: true })
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
}
