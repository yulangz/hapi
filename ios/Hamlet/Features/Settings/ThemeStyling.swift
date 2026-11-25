import HamletClient
import HamletUI
import SwiftUI

/// App-side mapping of the persisted `ThemeMode` (HamletClient, SwiftUI-free)
/// onto SwiftUI: the HamletUI palette RootView injects and the
/// `preferredColorScheme` override that keeps system chrome (bars, sheets,
/// system-colored surfaces) in step with an explicit choice.
extension ThemeMode {
    /// `nil` = follow the system; explicit modes force the matching scheme
    /// (OLED is a dark variant).
    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark, .oled: return .dark
        }
    }

    /// The HamletUI palette for this mode under the current system scheme:
    /// `.system` follows it, explicit modes override, OLED = dark palette on
    /// pure black.
    func hamletTheme(systemColorScheme: ColorScheme) -> HamletTheme {
        switch resolvedAppearance(systemIsDark: systemColorScheme == .dark) {
        case .light: return .light
        case .dark: return .dark
        case .oled: return .oled
        }
    }

    var label: String {
        switch self {
        case .system: return String(localized: "Follow system")
        case .light: return String(localized: "Light")
        case .dark: return String(localized: "Dark")
        case .oled: return String(localized: "OLED black")
        }
    }
}
