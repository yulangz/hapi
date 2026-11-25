import HamletClient
import Testing

@Suite("HamletClient scaffold")
struct SmokeTests {
    @Test func exposesVersionMetadata() {
        #expect(!HamletClientVersion.current.isEmpty)
        #expect(HamletClientVersion.protocolVersion == 1)
    }
}
