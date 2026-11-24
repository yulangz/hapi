import SwiftUI
import HamletUI
import Testing

@Suite("HamletTheme")
struct ThemeTests {
    @Test func variantsAndDarkFlag() {
        #expect(HamletTheme.light.variant == .light)
        #expect(HamletTheme.dark.variant == .dark)
        #expect(HamletTheme.oled.variant == .oled)
        #expect(!HamletTheme.light.isDark)
        #expect(HamletTheme.dark.isDark)
        #expect(HamletTheme.oled.isDark)
    }

    @Test func oledUsesPureBlackBackground() {
        #expect(HamletTheme.oled.background == Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 1))
        // Everything else inherits the dark palette.
        #expect(HamletTheme.oled.textPrimary == HamletTheme.dark.textPrimary)
        #expect(HamletTheme.oled.diffAddedBackground == HamletTheme.dark.diffAddedBackground)
    }

    @Test func palettesAreDistinct() {
        #expect(HamletTheme.light != HamletTheme.dark)
        #expect(HamletTheme.dark != HamletTheme.oled)
    }

    @Test func resolveMapsColorScheme() {
        #expect(HamletTheme.resolve(for: .light) == .light)
        #expect(HamletTheme.resolve(for: .dark) == .dark)
        #expect(HamletTheme.resolve(for: .dark, oledDark: true) == .oled)
        #expect(HamletTheme.resolve(for: .light, oledDark: true) == .light)
    }
}
