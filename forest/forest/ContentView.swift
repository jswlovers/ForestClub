import SwiftUI

struct ContentView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UITabBarController { NativeApp.makeRoot() }
    func updateUIViewController(_ uiViewController: UITabBarController, context: Context) {}
}

#Preview { ContentView() }
