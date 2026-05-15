/**
 * Static pattern arrays for pre-tool-use safety validation.
 *
 * Separated from safety.ts so the logic functions stay concise
 * while the (large) data lives in its own module.
 */

// Shared type used by every pattern list
export interface SafetyPattern {
  pattern: RegExp;
  reason: string;
}

// ============================================================================
// DANGEROUS BASH PATTERNS - Commands that should NEVER be run
// ============================================================================

export const DANGEROUS_BASH_PATTERNS: SafetyPattern[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM DESTRUCTION
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /rm\s+(-[rfRF]+\s+)*[/~]\s*$/,
    reason: 'Attempted to delete root or home directory',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/\*/,
    reason: 'Attempted to delete all files from root',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*~\//,
    reason: 'Attempted to delete home directory contents',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\$HOME/i,
    reason: 'Attempted to delete home directory contents',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/etc\b/,
    reason: 'Attempted to delete system configuration',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/boot\b/,
    reason: 'Attempted to delete boot partition',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/usr\b/,
    reason: 'Attempted to delete system binaries',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/var\b/,
    reason: 'Attempted to delete system data',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)*\/System\b/i,
    reason: 'Attempted to delete macOS system files',
  },

  // DD to block devices
  {
    pattern: /dd\s+.*of=\/dev\/(sd[a-z]|disk\d|nvme|hd[a-z])/i,
    reason: 'Attempted to overwrite disk device',
  },
  {
    pattern: />\s*\/dev\/(sd[a-z]|disk\d|nvme|hd[a-z])/i,
    reason: 'Attempted to redirect to disk device',
  },

  // Filesystem formatting
  {
    pattern: /mkfs\./i,
    reason: 'Attempted to format filesystem',
  },
  {
    pattern: /wipefs/i,
    reason: 'Attempted to wipe filesystem signatures',
  },

  // Fork bomb
  {
    pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/,
    reason: 'Fork bomb detected',
  },
  {
    pattern: /fork\s+while\s+fork/i,
    reason: 'Fork bomb variant detected',
  },
  {
    pattern: /\.\s*\/dev\/tcp/,
    reason: 'Potential fork bomb via /dev/tcp',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM SHUTDOWN / HALT
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /\b(shutdown|poweroff|halt)\b/i,
    reason: 'System shutdown command blocked',
  },
  {
    pattern: /\breboot\b/i,
    reason: 'System reboot command blocked',
  },
  {
    pattern: /\binit\s+[06]\b/,
    reason: 'Runlevel shutdown/reboot blocked',
  },
  {
    pattern: /systemctl\s+(reboot|poweroff|halt)/i,
    reason: 'Systemd shutdown command blocked',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // KILL INIT / ALL PROCESSES
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /kill\s+(-9\s+)?1\b/,
    reason: 'Attempted to kill init process',
  },
  {
    pattern: /kill\s+-9\s+-1\b/,
    reason: 'Attempted to kill all processes',
  },
  {
    pattern: /kill\s+.*SIGKILL.*\s+1\b/i,
    reason: 'Attempted to SIGKILL init process',
  },
  {
    pattern: /pkill\s+(-9\s+)?init/i,
    reason: 'Attempted to kill init process',
  },
  {
    pattern: /killall\s+(-9\s+)?init/i,
    reason: 'Attempted to kill init process',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // REVERSE SHELLS / BACKDOORS
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /\/dev\/tcp\//,
    reason: 'Reverse shell via /dev/tcp detected',
  },
  {
    pattern: /\/dev\/udp\//,
    reason: 'Reverse shell via /dev/udp detected',
  },
  {
    pattern: /bash\s+-i\s+>&?\s*\/dev\//,
    reason: 'Interactive bash reverse shell detected',
  },
  {
    pattern: /nc\s+.*-[ec]\s+\/bin/i,
    reason: 'Netcat reverse shell detected',
  },
  {
    pattern: /ncat\s+.*--exec/i,
    reason: 'Ncat reverse shell detected',
  },
  {
    pattern: /socat\s+.*exec:/i,
    reason: 'Socat reverse shell detected',
  },
  {
    pattern: /telnet\s+.*\|\s*\/bin/i,
    reason: 'Telnet reverse shell detected',
  },
  {
    pattern: /mkfifo\s+.*nc\s+/i,
    reason: 'Named pipe reverse shell detected',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SECURITY BYPASS / DISABLE
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /csrutil\s+disable/i,
    reason: 'Attempted to disable macOS SIP',
  },
  {
    pattern: /setenforce\s+0/i,
    reason: 'Attempted to disable SELinux',
  },
  {
    pattern: /spctl\s+--master-disable/i,
    reason: 'Attempted to disable macOS Gatekeeper',
  },
  {
    pattern: /ufw\s+disable/i,
    reason: 'Attempted to disable firewall',
  },
  {
    pattern: /iptables\s+-F/i,
    reason: 'Attempted to flush all firewall rules',
  },
  {
    pattern: /systemctl\s+(stop|disable)\s+firewalld/i,
    reason: 'Attempted to disable firewall service',
  },
  {
    pattern: /pfctl\s+-d/i,
    reason: 'Attempted to disable macOS packet filter',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HISTORY WIPING / COVERING TRACKS
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /history\s+-c/i,
    reason: 'Attempted to clear command history',
  },
  {
    pattern: />\s*~\/\.(bash|zsh|sh)_history/i,
    reason: 'Attempted to wipe shell history',
  },
  {
    pattern: /rm\s+.*\.(bash|zsh|sh)_history/i,
    reason: 'Attempted to delete shell history',
  },
  {
    pattern: /unset\s+HISTFILE/i,
    reason: 'Attempted to disable history logging',
  },
  {
    pattern: /export\s+HISTSIZE=0/i,
    reason: 'Attempted to disable history',
  },
  {
    pattern: /shred\s+.*history/i,
    reason: 'Attempted to destroy history file',
  },
  {
    pattern: /truncate\s+.*history/i,
    reason: 'Attempted to truncate history file',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CATASTROPHIC PERMISSION CHANGES
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /chmod\s+(-R\s+)?777\s+\//,
    reason: 'Attempted to make root world-writable',
  },
  {
    pattern: /chmod\s+(-R\s+)?777\s+\/\*/,
    reason: 'Attempted to make all root contents world-writable',
  },
  {
    pattern: /chown\s+-R\s+.*\s+\//,
    reason: 'Attempted to recursively change root ownership',
  },
  {
    pattern: /chmod\s+[ugo]?\+s\s+\//,
    reason: 'Attempted to set SUID/SGID on root',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PIPE TO SHELL FROM INTERNET
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
    reason: 'Pipe from curl to shell blocked',
  },
  {
    pattern: /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i,
    reason: 'Pipe from wget to shell blocked',
  },
  {
    pattern: /curl\s+[^|]*\|\s*(sudo\s+)?python/i,
    reason: 'Pipe from curl to python blocked',
  },
  {
    pattern: /wget\s+[^|]*\|\s*(sudo\s+)?python/i,
    reason: 'Pipe from wget to python blocked',
  },
  {
    pattern: /curl\s+[^|]*\|\s*(sudo\s+)?perl/i,
    reason: 'Pipe from curl to perl blocked',
  },
  {
    pattern: /curl\s+[^|]*\|\s*(sudo\s+)?ruby/i,
    reason: 'Pipe from curl to ruby blocked',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL FILE DESTRUCTION
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: />\s*\/etc\/(passwd|shadow|sudoers)/i,
    reason: 'Attempted to overwrite critical auth file',
  },
  {
    pattern: /rm\s+.*\/etc\/(passwd|shadow|sudoers)/i,
    reason: 'Attempted to delete critical auth file',
  },
  {
    pattern: /truncate\s+.*\/etc\/(passwd|shadow)/i,
    reason: 'Attempted to truncate critical auth file',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CRYPTO MINING / MALWARE PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    pattern: /xmrig|cryptonight|monero.*miner|coinhive/i,
    reason: 'Cryptocurrency mining software detected',
  },
  {
    pattern: /stratum\+tcp:\/\//i,
    reason: 'Mining pool connection detected',
  },
];

// ============================================================================
// DANGEROUS FILE PATHS - Paths that should never be written to
// ============================================================================

export const DANGEROUS_WRITE_PATHS: SafetyPattern[] = [
  // System directories
  {
    pattern: /^\/etc\//,
    reason: 'Cannot write to system configuration directory',
  },
  {
    pattern: /^\/usr\//,
    reason: 'Cannot write to system binaries directory',
  },
  {
    pattern: /^\/var\//,
    reason: 'Cannot write to system data directory',
  },
  {
    pattern: /^\/bin\//,
    reason: 'Cannot write to system binaries',
  },
  {
    pattern: /^\/sbin\//,
    reason: 'Cannot write to system binaries',
  },
  {
    pattern: /^\/boot\//,
    reason: 'Cannot write to boot partition',
  },
  {
    pattern: /^\/System\//i,
    reason: 'Cannot write to macOS system directory',
  },
  {
    pattern: /^\/Library\//i,
    reason: 'Cannot write to macOS system library',
  },

  // Sensitive user directories
  {
    pattern: /^~\/\.ssh\//,
    reason: 'Cannot write to SSH directory',
  },
  {
    pattern: /^\/.*\/\.ssh\//,
    reason: 'Cannot write to SSH directory',
  },
  {
    pattern: /^~\/\.gnupg\//,
    reason: 'Cannot write to GPG directory',
  },
  {
    pattern: /^~\/\.aws\//,
    reason: 'Cannot write to AWS credentials directory',
  },
  {
    pattern: /^~\/\.kube\//,
    reason: 'Cannot write to Kubernetes config directory',
  },
  {
    pattern: /^~\/\.docker\//,
    reason: 'Cannot write to Docker config directory',
  },

  // Browser profile directories (credential theft)
  {
    pattern: /Chrome.*\/Default\//i,
    reason: 'Cannot write to Chrome profile',
  },
  {
    pattern: /Firefox.*\/Profiles\//i,
    reason: 'Cannot write to Firefox profile',
  },
  {
    pattern: /Safari.*\/Cookies/i,
    reason: 'Cannot write to Safari data',
  },

  // Keychain / credential stores
  {
    pattern: /Keychains?\//i,
    reason: 'Cannot write to keychain directory',
  },
  {
    pattern: /\.keychain/i,
    reason: 'Cannot write to keychain file',
  },

  // Windows system directories
  {
    pattern: /^[A-Z]:\\Windows\\/i,
    reason: 'Cannot write to Windows system directory',
  },
  {
    pattern: /^[A-Z]:\\Windows$/i,
    reason: 'Cannot write to Windows system directory',
  },
  {
    pattern: /^[A-Z]:\\Program Files( \(x86\))?\\/i,
    reason: 'Cannot write to Program Files directory',
  },
  {
    pattern: /^[A-Z]:\\ProgramData\\/i,
    reason: 'Cannot write to ProgramData directory',
  },
  {
    pattern: /\\System32\\/i,
    reason: 'Cannot write to System32 directory',
  },
  {
    pattern: /\\SysWOW64\\/i,
    reason: 'Cannot write to SysWOW64 directory',
  },

  // Windows special device paths
  {
    pattern: /^\\\\\.\\/,
    reason: 'Cannot write to device path',
  },
  {
    pattern: /^\\\\\?\\/,
    reason: 'Cannot write to extended-length path',
  },

  // Windows credential / sensitive user directories
  {
    pattern: /\\\.ssh\\/i,
    reason: 'Cannot write to SSH directory',
  },
  {
    pattern: /\\\.gnupg\\/i,
    reason: 'Cannot write to GPG directory',
  },
  {
    pattern: /\\\.aws\\/i,
    reason: 'Cannot write to AWS credentials directory',
  },
  {
    pattern: /\\Credentials\\/i,
    reason: 'Cannot write to Windows Credentials directory',
  },
];

// ============================================================================
// DANGEROUS BROWSER PATTERNS
// ============================================================================

export const DANGEROUS_BROWSER_PATTERNS: SafetyPattern[] = [
  {
    pattern: /^file:\/\//i,
    reason: 'Local file access via browser blocked',
  },
  {
    pattern: /^chrome:\/\//i,
    reason: 'Browser internal URL blocked',
  },
  {
    pattern: /^about:/i,
    reason: 'Browser internal URL blocked',
  },
  {
    pattern: /^chrome-extension:\/\//i,
    reason: 'Extension URL blocked',
  },
];
