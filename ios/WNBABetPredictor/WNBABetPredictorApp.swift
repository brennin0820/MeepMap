import SwiftUI

@main
struct WNBABetPredictorApp: App {
    @StateObject private var apiClient = APIClient()

    var body: some Scene {
        WindowGroup {
            ContentView(apiClient: apiClient)
                .preferredColorScheme(.dark)
        }
    }
}
