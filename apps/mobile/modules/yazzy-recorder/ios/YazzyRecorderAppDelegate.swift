import ExpoModulesCore
import UIKit

/// Creates the recorder at launch so CoreBluetooth state restoration and the armed flag work even when iOS relaunches the app in the background for the adapter.
public class YazzyRecorderAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    _ = NativeRecorder.shared
    return true
  }
}
