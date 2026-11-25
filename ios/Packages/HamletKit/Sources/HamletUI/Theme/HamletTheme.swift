import SwiftUI

/// Semantic color tokens for the HAMLET rendering components.
///
/// Three fixed palettes are provided: `.light`, `.dark`, and `.oled`
/// (dark with pure-black backgrounds for OLED displays). The app injects
/// the palette via the environment (`.hamletTheme(_:)`); components read it
/// through `@Environment(\.hamletTheme)`.
///
/// Deliberately minimal — plain value type, fixed token set, no theming DSL.
public struct HamletTheme: Equatable, Sendable {
    public enum Variant: String, Equatable, Sendable {
        case light
        case dark
        case oled
    }

    public var variant: Variant

    // MARK: Core surfaces & text

    public var background: Color
    public var surface: Color
    public var textPrimary: Color
    public var textSecondary: Color
    public var textHint: Color
    public var divider: Color

    // MARK: Semantic accents

    public var accent: Color
    public var link: Color
    public var success: Color
    public var warning: Color
    public var danger: Color

    // MARK: Code

    public var codeBackground: Color
    public var codeHeaderBackground: Color
    public var inlineCodeBackground: Color
    public var inlineCodeForeground: Color

    // MARK: Markdown blocks

    public var quoteBar: Color
    public var quoteBackground: Color
    public var tableHeaderBackground: Color

    // MARK: Diff

    public var diffAddedBackground: Color
    public var diffAddedForeground: Color
    public var diffRemovedBackground: Color
    public var diffRemovedForeground: Color
    public var hunkHeaderBackground: Color

    /// True for the `.dark` and `.oled` palettes (drives e.g. the
    /// highlight.js theme choice in `CodeBlockView`).
    public var isDark: Bool { variant != .light }

    // MARK: - Palettes

    public static let light = HamletTheme(
        variant: .light,
        background: Color(hamletHex: 0xFFFFFF),
        surface: Color(hamletHex: 0xF6F7F9),
        textPrimary: Color(hamletHex: 0x1C1D22),
        textSecondary: Color(hamletHex: 0x52555E),
        textHint: Color(hamletHex: 0x8A8D96),
        divider: Color(hamletHex: 0xE5E7EB),
        accent: Color(hamletHex: 0x3B82F6),
        link: Color(hamletHex: 0x2563EB),
        success: Color(hamletHex: 0x16A34A),
        warning: Color(hamletHex: 0xD97706),
        danger: Color(hamletHex: 0xDC2626),
        codeBackground: Color(hamletHex: 0xF6F8FA),
        codeHeaderBackground: Color(hamletHex: 0xEEF1F4),
        inlineCodeBackground: Color(hamletHex: 0xEEF1F4),
        inlineCodeForeground: Color(hamletHex: 0x1C1D22),
        quoteBar: Color(hamletHex: 0xD1D5DB),
        quoteBackground: Color(hamletHex: 0xF8F9FB),
        tableHeaderBackground: Color(hamletHex: 0xF2F4F7),
        diffAddedBackground: Color(hamletHex: 0xDDF4E4),
        diffAddedForeground: Color(hamletHex: 0x116329),
        diffRemovedBackground: Color(hamletHex: 0xFFEBE9),
        diffRemovedForeground: Color(hamletHex: 0xA40E26),
        hunkHeaderBackground: Color(hamletHex: 0xF1F8FF)
    )

    public static let dark = HamletTheme(
        variant: .dark,
        background: Color(hamletHex: 0x0F1115),
        surface: Color(hamletHex: 0x171A21),
        textPrimary: Color(hamletHex: 0xE8EAED),
        textSecondary: Color(hamletHex: 0xA8ADB8),
        textHint: Color(hamletHex: 0x6E7481),
        divider: Color(hamletHex: 0x2A2E37),
        accent: Color(hamletHex: 0x6C9EFF),
        link: Color(hamletHex: 0x7CA9FF),
        success: Color(hamletHex: 0x3FB950),
        warning: Color(hamletHex: 0xD29922),
        danger: Color(hamletHex: 0xF85149),
        codeBackground: Color(hamletHex: 0x161B22),
        codeHeaderBackground: Color(hamletHex: 0x1F242D),
        inlineCodeBackground: Color(hamletHex: 0x262C36),
        inlineCodeForeground: Color(hamletHex: 0xE8EAED),
        quoteBar: Color(hamletHex: 0x3B4048),
        quoteBackground: Color(hamletHex: 0x14171C),
        tableHeaderBackground: Color(hamletHex: 0x1C2028),
        diffAddedBackground: Color(hamletHex: 0x12261E),
        diffAddedForeground: Color(hamletHex: 0x3FB950),
        diffRemovedBackground: Color(hamletHex: 0x2D1215),
        diffRemovedForeground: Color(hamletHex: 0xF85149),
        hunkHeaderBackground: Color(hamletHex: 0x161F2E)
    )

    /// Dark palette on pure-black backgrounds (OLED power saving).
    public static let oled: HamletTheme = {
        var theme = HamletTheme.dark
        theme.variant = .oled
        theme.background = Color(hamletHex: 0x000000)
        theme.surface = Color(hamletHex: 0x0A0A0C)
        theme.codeBackground = Color(hamletHex: 0x0B0D10)
        theme.codeHeaderBackground = Color(hamletHex: 0x101318)
        theme.quoteBackground = Color(hamletHex: 0x050608)
        theme.tableHeaderBackground = Color(hamletHex: 0x101216)
        theme.divider = Color(hamletHex: 0x1F2329)
        return theme
    }()

    /// Convenience mapping from the system color scheme.
    public static func resolve(for colorScheme: ColorScheme, oledDark: Bool = false) -> HamletTheme {
        switch colorScheme {
        case .dark: return oledDark ? .oled : .dark
        default: return .light
        }
    }
}

extension Color {
    /// 0xRRGGBB constant color (sRGB, full opacity).
    init(hamletHex hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: 1.0
        )
    }
}

// MARK: - Environment plumbing

private struct HamletThemeKey: EnvironmentKey {
    static let defaultValue = HamletTheme.light
}

public extension EnvironmentValues {
    /// The active HAMLET palette. Defaults to `.light`; the app is expected to
    /// inject the palette matching the system appearance at its root:
    ///
    ///     ContentView().hamletTheme(.resolve(for: colorScheme, oledDark: prefersOLED))
    var hamletTheme: HamletTheme {
        get { self[HamletThemeKey.self] }
        set { self[HamletThemeKey.self] = newValue }
    }
}

public extension View {
    /// Injects a HAMLET palette for this subtree.
    func hamletTheme(_ theme: HamletTheme) -> some View {
        environment(\.hamletTheme, theme)
    }
}
