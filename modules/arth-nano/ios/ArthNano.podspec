Pod::Spec.new do |s|
  s.name           = 'ArthNano'
  s.version        = '1.0.0'
  s.summary        = 'On-device AI for Arth on iPhone (Apple Foundation Models).'
  s.description    = 'Asks the Apple Intelligence on-device model, on the iPhone, with nothing sent anywhere.'
  s.license        = 'UNLICENSED'
  s.author         = 'Sourav Baid'
  s.homepage       = 'https://souravbaid.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/kaiser7292/arth' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # iOS 26 and later only: weakly linked, so the app still starts on older iPhones.
  s.weak_frameworks = 'FoundationModels'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
