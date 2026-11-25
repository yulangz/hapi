// swift-tools-version: 6.0
import PackageDescription

// HamletUI (SwiftUI + swift-markdown + Highlightr) cannot build on Linux, but
// HamletProtocol and HamletClient are pure Foundation and are compile- and
// fixture-verified in a Linux container by `ios/scripts/linux-test.sh`.
// Package manifests are Swift evaluated on the build host, so `#if os(Linux)`
// is the supported way to drop the UI product/targets (and their third-party
// dependencies) from the Linux build while keeping one manifest.

var products: [Product] = [
    .library(name: "HamletProtocol", targets: ["HamletProtocol"]),
    .library(name: "HamletClient", targets: ["HamletClient"]),
]

var dependencies: [Package.Dependency] = []

var targets: [Target] = [
    // Pure protocol layer: wire models, chat pipeline, window logic.
    // Must stay Foundation-only so it can be verified against
    // shared/fixtures/** without any UI or transport concerns.
    .target(name: "HamletProtocol"),
    // Transport layer: APIClient, auth, SSE, stores (lands in M1).
    .target(name: "HamletClient", dependencies: ["HamletProtocol"]),
    .testTarget(name: "HamletProtocolTests", dependencies: ["HamletProtocol"]),
    // HamletProtocol is named directly by SSE tests (SyncEvent assertions).
    .testTarget(name: "HamletClientTests", dependencies: ["HamletClient", "HamletProtocol"]),
]

#if !os(Linux)
products.append(.library(name: "HamletUI", targets: ["HamletUI"]))
dependencies += [
    // GFM parsing for the custom SwiftUI markdown renderer (HamletUI).
    // The org moved from `apple` to `swiftlang`; product name is `Markdown`.
    .package(url: "https://github.com/swiftlang/swift-markdown.git", from: "0.5.0"),
    // JavaScriptCore-backed highlight.js wrapper for code blocks. Kept
    // behind the `SyntaxHighlighting` protocol so it can be swapped out.
    .package(url: "https://github.com/raspu/Highlightr.git", from: "2.2.0"),
]
targets += [
    // Rendering foundation: markdown renderer + pre-parse transforms,
    // code blocks with syntax highlighting, unified-diff view, theme.
    .target(
        name: "HamletUI",
        dependencies: [
            "HamletProtocol",
            .product(name: "Markdown", package: "swift-markdown"),
            .product(name: "Highlightr", package: "Highlightr"),
        ]
    ),
    .testTarget(name: "HamletUITests", dependencies: ["HamletUI"]),
]
#endif

let package = Package(
    name: "HamletKit",
    platforms: [
        // The app targets iOS 17+. macOS is declared so `swift test` can run
        // the package on macOS CI runners (the code is pure Foundation).
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: products,
    dependencies: dependencies,
    targets: targets
)
