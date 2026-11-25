import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtimePath } from '@/projectPath'

const marker = '\n<!-- Installed by Hamlet Runner -->\n'

export async function installManagedSkill(codexHome: string) {
    const skill = join('skills', 'hamlet-agent')
    const directory = join(codexHome, skill)
    const target = join(directory, 'SKILL.md')
    const bundled = await readFile(join(runtimePath(), skill, 'SKILL.md'), 'utf8') + marker
    await mkdir(directory, { recursive: true })
    const current = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return null
    })
    if (current !== null && (!current.endsWith(marker) || current === bundled)) return
    const temporary = join(directory, '.SKILL-' + randomUUID())
    try {
        await writeFile(temporary, bundled)
        await rename(temporary, target)
    } finally {
        await rm(temporary, { force: true })
    }
}
