Pod::Spec.new do |s|
  s.name           = 'ArthTextReader'
  s.version        = '1.0.0'
  s.summary        = 'On-device text recognition with line positions (Vision).'
  s.description    = 'Reads payment screenshots for Arth with Apple Vision, on the device.'
  s.license        = 'UNLICENSED'
  s.author         = 'Sourav Baid'
  s.homepage       = 'https://souravbaid.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/kaiser7292/arth' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
