# Bundled public-data licenses

Each JSON under `assets/data/` that derives from a public upstream carries
its license here.

| Bundle | License | Upstream |
|---|---|---|
| mcc-codes.json | Unlicense (public domain) | https://github.com/greggles/mcc-codes |
| ifsc-prefixes.json | MIT | https://github.com/razorpay/ifsc |
| sms-senders.json | Artha-authored | — |
| sms-templates.json | Artha-authored (regex derivative work over factual SMS content) | — |
| merchant-brands.json | Artha-authored | — |

Regenerated via `node scripts/build-data-bundles.mjs` during batch builds.
