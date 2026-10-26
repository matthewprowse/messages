// swift-tools-version:5.10
import Foundation
import PackageDescription

// Konva Relay: reads iCloud Reminders on the user's Mac with EventKit and syncs them with the Konva worker.
// RelayCore is the protocol and the mapping, with no EventKit, so it can be unit tested anywhere.

// Embedded in the bare binary too, so macOS knows why it asks for Reminders when run outside the app bundle.
let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Info.plist").path

let package = Package(
  name: "KonvaRelay",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "konva-relay", targets: ["KonvaRelay"])],
  targets: [
    .target(name: "RelayCore"),
    .executableTarget(
      name: "KonvaRelay",
      dependencies: ["RelayCore"],
      linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist])]
    ),
    .testTarget(name: "RelayCoreTests", dependencies: ["RelayCore"]),
  ]
)
