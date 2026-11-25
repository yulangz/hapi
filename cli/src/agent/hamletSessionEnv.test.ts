import { afterEach, describe, expect, it } from 'vitest'
import { configuration } from '@/configuration'
import {
    HAMLET_SESSION_ID_ENV,
    exportHamletHubAuthEnv,
    exportHamletSessionEnv
} from './hamletSessionEnv'

describe('exportHamletSessionEnv', () => {
    afterEach(() => {
        delete process.env[HAMLET_SESSION_ID_ENV]
    })

    it('publishes HAMLET_SESSION_ID for child agent shells', () => {
        exportHamletSessionEnv('session-abc')
        expect(process.env[HAMLET_SESSION_ID_ENV]).toBe('session-abc')
    })

    it('ignores empty session ids', () => {
        delete process.env[HAMLET_SESSION_ID_ENV]
        exportHamletSessionEnv('')
        expect(process.env[HAMLET_SESSION_ID_ENV]).toBeUndefined()
    })
})

describe('exportHamletHubAuthEnv', () => {
    const previousUrl = process.env.HAMLET_API_URL
    const previousToken = process.env.CLI_API_TOKEN
    const previousConfigUrl = configuration.apiUrl
    const previousConfigToken = configuration.cliApiToken

    afterEach(() => {
        if (previousUrl === undefined) {
            delete process.env.HAMLET_API_URL
        } else {
            process.env.HAMLET_API_URL = previousUrl
        }
        if (previousToken === undefined) {
            delete process.env.CLI_API_TOKEN
        } else {
            process.env.CLI_API_TOKEN = previousToken
        }
        configuration._setApiUrl(previousConfigUrl)
        configuration._setCliApiToken(previousConfigToken)
    })

    it('mirrors configured hub URL into process.env for child shells', () => {
        delete process.env.HAMLET_API_URL
        delete process.env.CLI_API_TOKEN
        configuration._setApiUrl('http://remote-hub:3006')
        configuration._setCliApiToken('runner-token')

        exportHamletHubAuthEnv({ exportApiUrl: true })

        expect(process.env.HAMLET_API_URL).toBe('http://remote-hub:3006')
        expect(process.env.CLI_API_TOKEN).toBeUndefined()
    })

    it('does not clear an existing CLI_API_TOKEN when exporting URL only', () => {
        process.env.HAMLET_API_URL = 'http://already-set:3006'
        process.env.CLI_API_TOKEN = 'already-set-token'
        configuration._setApiUrl('http://config-hub:3006')
        configuration._setCliApiToken('settings-token')

        exportHamletHubAuthEnv({ exportApiUrl: true })

        expect(process.env.HAMLET_API_URL).toBe('http://config-hub:3006')
        expect(process.env.CLI_API_TOKEN).toBe('already-set-token')
    })

    it('does not export URL or token when api URL is the implicit default', () => {
        delete process.env.HAMLET_API_URL
        delete process.env.CLI_API_TOKEN
        configuration._setApiUrl('http://localhost:3006')
        configuration._setCliApiToken('local-token')

        exportHamletHubAuthEnv({ exportApiUrl: false })

        expect(process.env.HAMLET_API_URL).toBeUndefined()
        expect(process.env.CLI_API_TOKEN).toBeUndefined()
    })

    it('never mirrors settings/prompt tokens into process.env', () => {
        delete process.env.HAMLET_API_URL
        delete process.env.CLI_API_TOKEN
        configuration._setApiUrl('http://remote-hub:3006')
        configuration._setCliApiToken('settings-secret')

        exportHamletHubAuthEnv({ exportApiUrl: true })

        expect(process.env.CLI_API_TOKEN).toBeUndefined()
    })
})
