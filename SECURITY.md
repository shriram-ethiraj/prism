# Security and private device data

Do not publish credentials or raw device/recovery logs in issues. Revoke exposed credentials through the issuing service and remove public copies if an accidental disclosure occurs.

For a security issue, use GitHub's private vulnerability reporting if enabled on this repository. If it is unavailable, open a minimal issue asking for a private reporting channel without exploit details or private data.

Developer Mode exposes a privileged development connection on a trusted LAN. Prism setup uses explicitly selected devices, bounded commands, and private external state. It does not enable root, modify firmware, or install a persistent remote administration service. Keep signing identities stable for updates. Recovery snapshots describe selected settings and are not firmware backups.
