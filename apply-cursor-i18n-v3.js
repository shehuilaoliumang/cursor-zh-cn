"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const os = require("os");
const HOME = process.env.USERPROFILE || os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
const INSTALL_ROOT = process.env.CURSOR_INSTALL_ROOT || path.join(LOCALAPPDATA, "Programs", "cursor");
const APP_ROOT = path.join(INSTALL_ROOT, "resources", "app");
const SCRIPT_DIR = __dirname;
const WORK_DIR = process.env.CURSOR_I18N_WORK || (
  fs.existsSync(path.join(SCRIPT_DIR, "hardcoded-patch-dict-v3.json"))
    ? SCRIPT_DIR
    : path.join(HOME, "cursor-i18n-apply")
);
const DEFAULT_BACKUP_DIR = path.join(HOME, "cursor-i18n-backup-3.32.4-20261125");
const LEGACY_BACKUP_DIR = path.join(HOME, "cursor-i18n-backup-3.31.15-20261122");
const EXPECTED_VERSION = "3.32.4";

const BUNDLES = [
  "out/vs/workbench/workbench.desktop.main.js",
  "out/vs/workbench/workbench.glass.main.js",
  "out/vs/workbench/workbench.anysphere-ui.js",
  "out/vs/workbench/workbench.anysphere-ui-automations.js",
  "out/vs/workbench/workbench.xai-commerce-prepaid.js"
];

const BACKUP_MAP = {
  "out/vs/workbench/workbench.desktop.main.js": "app/out_vs_workbench_workbench.desktop.main.js",
  "out/vs/workbench/workbench.glass.main.js": "app/out_vs_workbench_workbench.glass.main.js",
  "out/vs/workbench/workbench.anysphere-ui.js": "app/out_vs_workbench_workbench.anysphere-ui.js",
  "out/vs/workbench/workbench.anysphere-ui-automations.js": "app/out_vs_workbench_workbench.anysphere-ui-automations.js",
  "out/vs/workbench/workbench.xai-commerce-prepaid.js": "app/out_vs_workbench_workbench.xai-commerce-prepaid.js",
  "product.json": "app/product.json"
};


/** Only these fields are shown to the user. Anything else is left alone. */
const UI_FIELDS = [
  'label', 'description', 'placeholder', 'accessibleLabel', 'ariaLabel', 'tooltip',
  'subtitle', 'buttonLabel', 'emptyLabel', 'emptyText', 'heading',
  'confirmText', 'title', 'children', 'actionTitle'
];

const FIELD_RE = new RegExp(
  `\\b(${UI_FIELDS.join('|')})\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
  'g'
);

function unescapeJs(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, token) => {
    if (token.startsWith('u')) return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    return { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[token] ?? token;
  });
}

function escapeJs(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function translateLiteral(raw, dict, hits) {
  const english = unescapeJs(raw);
  if (!Object.prototype.hasOwnProperty.call(dict, english)) return null;
  const translated = dict[english];
  if (typeof translated !== 'string' || translated === english) return null;
  hits.set(english, (hits.get(english) || 0) + 1);
  return escapeJs(translated);
}

/**
 * 设置侧栏标题按内部 ID 匹配，只替换已知版本的英文显示值。
 * 相同 ID 还用于图标、颜色及缩写表（如 `mcp:"MCP"`），这些值保持原样。
 */
const SIDEBAR_ENGLISH = {
  general: 'General',
  profile: 'Profile',
  'vscode-settings': 'VS Code Settings',
  appearance: 'Appearance',
  fun: 'Fun',
  'plan-usage': 'Plan & Usage',
  chat: 'Agents',
  browser: 'Browser & Network',
  tab: 'Tab',
  models: 'Models',
  voice: 'Voice',
  'git-prs': ['Git & PRs', 'Source Control'],
  rules: 'Rules, Skills, Subagents',
  plugins: 'Plugins',
  customize: 'Customize',
  indexing: 'Indexing',
  mcp: 'Tools & MCPs',
  hooks: 'Hooks',
  beta: 'Beta',
  network: 'Network',
  'background-composer': 'Cloud Agents',
  'grok-bot': 'Grok Bot',
  'self-driving': 'Self-Driving PRs',
  worktrees: 'Worktrees',
  developer: 'Developer',
  docs: 'Docs',
  'remote-control': 'Remote Control',
  'code-intelligence': 'Code Intelligence',
  contact: 'Contact'
};

/** Composer mode names, one object, same text in the desktop and glass bundles. */
const MODE_FROM = 'agent:"Agent",chat:"Chat",background:"Cloud",plan:"Plan",spec:"Spec",debug:"Debug",triage:"Triage"';
const MODE_PARTS = [
  ['agent', 'Agent'],
  ['chat', 'Chat'],
  ['background', 'Cloud'],
  ['plan', 'Plan'],
  ['spec', 'Spec'],
  ['debug', 'Debug'],
  ['triage', 'Triage']
];

/** Quoted literals that are shown as-is, not as a `label:` / `title:` field. */
const BARE_LABELS = [
  'Search actions...',
  'Editor Window',
  'Rules, Skills, Subagents',
  'Code Intelligence',
  'Indexing',
  'Privacy Mode',
  'Privacy Mode (Legacy)',
  'Switch to Agents Window',
  'Try it now',
  'Run many agents in parallel \u2014 across repos, locally, on remote SSH, and in the cloud.',
  'System Tray Icon',
  'Show Cursor in system tray',
  'Menu Bar Icon',
  'Show Cursor in menu bar',
  'Get Cursor for iOS',
  'Get Grok Bot',
  'Contact Us',
  'Log Out',
  'Share Data',
  'Data Sharing Enabled',
  'You can also manage Privacy Mode in the',
  'Unify dashboard',
  'Open Privacy Settings',
  'Configure here.',
  'Learn more about Data Sharing.',
  'Data Sharing is paused for your first day of usage.',
  'Improve Cursor for everyone',
  'No training. Code may be stored for Background Agent and other features.',
  'Choose the default behavior of messages sent while Agent is working',
  'Custom words that submit a voice prompt. Spaces and punctuation are ignored.',
  'Third-Party Imports',
  'Choose how Agents run tools like command execution, MCP, and file writes.',
  "A classifier will run for each action and decide whether it's safe to execute this command. Allowlists are still respected.",
  'File-Deletion Protection',
  'External-File Protection',
  'Allowlist Options',
  'You can configure Shell, MCP and Fetch allowlists for Auto mode. However, Auto works well without these.',
  'You can configure Shell, MCP, Fetch, and Read allowlists for Auto mode. However, Auto works well without these.',
  'Choose Origin (cursor.com/codebase) or GitHub for GitHub pull request links on web and desktop',
  'Choose Origin (cursor.com/codebase), GitHub, or Graphite for pull request links on web and desktop',
  'Inside Cursor',
  'Index Repositories for Instant Grep',
  'Automatically index repositories to speed up Grep searches. All data is stored locally.',
  'Start from scratch',
  'Use Existing...',
  'This PC',
  'This Mac',
  'This Computer',
  'Submit with Ctrl + Enter',
  'Learn more',
  'When enabled, your cursor.com profile page is visible to anyone with the link.',
  'Public profiles are disabled by your team admin.',
  'Current Plan',
  'Upgrade Available',
  'Adjust Plan',
  'Unlock 3x more usage on Agent & more',
  'Cursor Models',
  'Includes Cursor Grok and Composer',
  'Other Models',
  'Additional usage beyond limits consumes Other Models quota or on-demand spend.',
  'Additional usage beyond limits consumes on-demand spend.',
  'Search Settings',
  'Remote Control',
  'Control local agents on this computer from the Cursor iOS app.',
  'This computer',
  'Control local agents from your phone',
  'Start, check, and reply to agents running on this computer. Needs Cursor open and the computer awake.',
  'Computer name',
  'How this computer appears in the iOS app.',
  'Keep this computer awake',
  'Stay connected to your phone while plugged in.',
  'Paired devices',
  'Paired Devices',
  'No devices paired yet',
  'Scan a QR code with your iPhone camera to pair.',
  'Pair a device',
  'Pair a Device',
  'Other computers',
  'Automatically register computers',
  'Turn on Remote Control when you sign in on another computer.',
  'Disable on all of my computers',
  'You can register again later.',
  'Unregister all',
  'Self-Hosted Workers',
  'Enable local self-hosted workers',
  'Allow cloud agents to run in your local environment.',
  'Remote Control pairing QR code',
  'Check clock',
  'Another window',
  'Remote Control is running in another Cursor window',
  'This computer’s clock is wrong; set the date and time automatically to connect',
  'Scan with your iPhone camera to open Cursor and pair.',
  'Turn on Remote Control to show a code.',
  'Turn On Remote Control',
  'Turning on Remote Control…',
  'Preparing a code…',
  'Remote Control is on in another Cursor window.',
  'Copy Link',
  'Don’t have the app?',
  'Don\'t have the app?',
  'Get it on the App Store',
  'New Code',
  'Device paired',
  'Couldn’t pair',
  'Couldn\'t pair',
  'Get a new code and scan it again.',
  'Allowing…',
  'Go to Remote Control settings',
  'Pair another device',
  'Turn Remote Control on again to reset this computer',
  'No devices are currently paired with this computer.',
  'Unnamed device',
  'Disconnect…',
  'Disconnect from this computer',
  'It won’t be able to control this computer until it’s authorized here again.',
  'Disconnect from all computers',
  'It won’t be able to control any of your computers. To use it again, authorize it as a new device.',
  'Remote Control runs on a cloud agent, which requires data storage that your current privacy mode disables',
  'Disable Remote Control on all of your computers?',
  'This will turn off Remote Control on every computer associated with your account.',
  'Couldn’t unregister some computers. Try again.',
  'Couldn\'t unregister some computers. Try again.',
  'Allow this device?',
  'It will be able to start, check, and reply to agents on this computer. Only allow it if your device shows this code:',
  'Don’t allow',
  'Don\'t allow',
  'Not used yet',
  'Last used just now',
  'Requested just now',
  'Requested 1 minute ago',
  '1 device waiting for approval',
  'Allow agents on this computer to be controlled remotely from mobile',
  'Auto-Review',
  'Auto-Review (with Sandbox)',
  'Auto-review',
  'Auto-review (with Sandbox)',
  'Allowlist',
  'Run Everything',
  'Run Everything (Unsandboxed)',
  'Auto-Accept Web Search',
  'Skip approval dialog; Agent may run web searches automatically',
  'Wait indefinitely to authenticate when prompted. When off, skip authentication prompts after 30 seconds.',
  'Browser Automation',
  'Browser Protection',
  'Connected to Browser Tab',
  'Browser Tab',
  'Browser automation disabled',
  'Prevent Agent from automatically running Browser tools',
  'Open Local Links in Cursor Browser',
  'Open Web Links in Cursor Browser',
  'Automatically open localhost links in the Browser Tab',
  'Automatically open http and https links in the Browser Tab',
  'By default, get notifications for stable updates. In Early Access, pre-release builds may be unstable for production work.',
  'Plan, Build, / for skills, @ for context',
  'Plan New Idea',
  'Multitask',
  'Run in Cloud',
  'Run locally in a Worktree',
  'Start with a plan',
  'Align on implementation before writing code',
  'Debug an issue',
  'Find root causes and fix tricky bugs',
  'New Automation',
  'No Automations Yet',
  'Ship better code, faster',
  'Review Code with Bugbot',
  'Catch bugs and auto-fix before they ship.',
  'Scan and Triage Security Vulnerabilities',
  'Security checks on every change.',
  'Route PR Reviews and Auto-Approve',
  'Assign reviewers and approve PRs.',
  'Get Started',
  'All Runs',
  'Mine',
  'Team',
  'Search...',
  'New Project',
  'Projects',
  'Automate repetitive tasks with always-on agents and configure Cursor\'s built-in agents for your team.',
  'Show status filters',
  'Show PR filters',
  'Show environment filters',
  'Sidebar filters',
  'Hide Sidebar',
  'Show Sidebar',
  'No Repo',
  'Remote Machine',
  'All Remote Machines',
  'Partial Accepts',
  'Hierarchical .cursorignore',
  'Ignore Symlinks in .cursorignore Search',
  'Copy Domains',
  'Run Diagnostic',
  'Running Diagnostic',
  'Coordinator effort',
  'Add Custom Model',
  'Prevent sleep',
  'Keep your computer awake and connected while plugged in.',
  'Turn on Remote Control to keep this computer awake',
  'Computer Use',
  'Always Allow',
  'Allow once',
  'Allow in this chat',
  'Run Mode Controlled by Team Admin',
  'Run Mode Controlled by Team Admin (Sandbox Enabled)',
  'Weekly usage limit',
  'Monthly usage limit',
  'Weekly usage limit reached',
  'Usage limit reached',
  'Weekly usage limit reached. It resets in 4 days.',
  'Usage limit reached, but you can continue at reduced speeds.',
  "You've reached your limit. Responses may be slower. Upgrade for more usage.",
  'Get more usage to continue',
  'Get more usage to switch models',
  'Get More Usage',
  'Upgrade to keep going.',
  'Adjust your limits to keep going.',
  'Additional usage credits',
  'Extra usage credits',
  'Buy credits',
  'Buy Credits',
  'Set auto top-up',
  'Set Auto Top-Up',
  'Auto top-up when balance is low',
  'Automatic top-ups',
  'Top up amount',
  'Top up when balance is below',
  'Monthly usage',
  'Monthly spend limit',
  'Edit monthly spend limit',
  'Monthly spend limit reached. Increase your limit to continue working.',
  'Set a monthly limit for usage credits',
  'Monthly additional usage',
  'Monthly additional usage limit',
  'Edit monthly additional usage limit',
  'Monthly additional usage limit reached. Increase your limit to continue working.',
  'A monthly spend limit for your additional usage.',
  'Credits expire after two years',
  'Buy credits unavailable',
  "Credits can't be purchased here right now. You can add credits from the billing settings instead.",
  'Could not load the credit balance',
  'Top up your balance to avoid interruptions.',
  'System font',
  'System monospace',
  'Task Models',
  'Required domains',
  'Many commands will run automatically inside the sandbox, and a classifier will run for the actions that cannot run in the sandbox. Allowlists are still respected.',
  'Many commands will run automatically inside the sandbox, and you can also allowlist other actions.',
  'Agent will ask for approval before running tools.',
  'Commands that are allowlisted will run automatically.',
  'Control whether agents can read files outside the workspace without approval',
  'Control whether agents can read files outside the workspace without approval.',
  "A new Project's coordinator starts at this effort. You can change it in the chat's model picker.",
  'Allow agent to switch to modes without asking. When off, skips if unanswered within 15 seconds.',
  'Run Mode',
  'Run Mode Disabled by Team Admin',
  'Enable Computer Use',
  'Computer Use is ready',
  'Disabled by your team admin.',
  'Enabled by Run Everything Auto-Run Mode: Agent bypasses approval prompts for tools including Web Search.',
  'Enabled by Run Everything Auto-Run Mode.',
  'Allow the agent to celebrate with a shower of confetti',
  'Unavailable while Reduce Motion is on (from settings or your system)',
  'Access app interfaces',
  'Use screenshots as context',
  'By clicking Buy credits, you agree that we will charge the card you have on file for the amounts listed above and on a recurring basis for the top-up amount. To cancel, turn off in Settings.',
  'By clicking Buy credits, you allow us to charge your card in the amount above.'
];

/** Fragments inside template literals. The translation is the dictionary value. */
const PHRASES = [
  'Prevent Agent from creating or modifying files outside of the workspace automatically',
  'copyLink:"复制链接",copied:"Copied"',
  'answering:"正在允许…",done:"Done"',
  'answering:"正在允许\\u2026",done:"Done"',
  'copyLink:"Copy Link",copied:"Copied"',
  'answering:"Allowing…",done:"Done"',
  'answering:"Allowing\\u2026",done:"Done"',
  'return t===""?"Allow this device?":`Allow \\u201C${t}\\u201D?`',
  'return t.label===""?"this device":`\\u201C${t.label}\\u201D`',
  'Waiting for approval \\xB7 code ${t.code}',
  't.lastUsedAtMs===void 0?"Not used yet"',
  '?"Last used just now":`Last used ${Ine(t.lastUsedAtMs,!0)}`',
  't.count===1?"1 device waiting for approval":`${t.count} devices waiting for approval`',
  't===""?"This device":`\\u201C${t}\\u201D`} can now control agents on this computer.',
  'e<1?"Requested just now":e===1?"Requested 1 minute ago":`Requested ${e} minutes ago`',
  '`Disconnect ${Dc_(t)} from this computer?`',
  '`Disconnect ${Dc_(t)} from all computers?`',
  '"Data Sharing is controlled by ",b?"the":"your"," team admin."',
  '"Sharing will activate in ",f," hour",f===1?"":"s","."',
  '"Data Sharing is controlled by ",S?"the":"your"," team admin."',
  '"Sharing will activate in ",g," hour",g===1?"":"s","."',
  'Prevent Agent from deleting files automatically',
  'Use with caution. Skip symlinks during .cursorignore file discovery. Enable only when all .cursorignore files are reachable without symlinks.',
  'Apply .cursorignore files to all subdirectories',
  'Changing this setting requires restarting Cursor.',
  ' (controlled by admin)',
  'Accept the next word of a suggestion via ',
  'Automatically import necessary modules for ',
  'Automatically parse links when pasted into Quick Edit (',
  "Mark Agent commits as 'Made with Cursor'",
  'Mark pull requests as made with Cursor',
  'Automatically index repositories to speed up Grep searches. All data is stored locally.',
  'Usage limits reset on ',
  '${s} hour${s===1?"":"s"} and ${o} minute${o===1?"":"s"} left',
  '${s} hour${s===1?"":"s"} left',
  '${o} minute${o===1?"":"s"} left',
  '${a} day${a===1?"":"s"} left',
  '${dh1(t)}% used',
  'Included in ',
  'Enter submits chat, Enter inserts a newline, and primary actions move to ',
  'Submit with ',
  'return"Customize"',
  'name:"Customize"',
  'value:"New Chat"',
  '||"New Chat"',
  '??"New Chat"',
  'LABEL="New Chat"',
  'pageTitle:"Automations"',
  'e7a="New Chat"',
  'MUd="New Chat"',
  'pjl="New Chat"',
  'bTg="New Agent"',
  't<=0?"Terminal":t===1?"1 Terminal":`${t} Terminals`',
  'label:h.title.trim()||"Terminal"',
  't.folders.length>1?"Workspace":"Home"',
  'sectionHeaderLabel:`On ${t.workspaceName.trim()||"workspace"}`',
  'return"Side Chat"',
  'return"Canvas"',
  'return"Machine Metrics"',
  'return"Voice call"',
  'return"Gallery"',
  'return"Colors"',
  'return"Desktop"',
  'return"Changes"',
  'return"Output"',
  'return"Context"',
  'return"Pull Request"',
  'default:return"Tab"',
  'case $t.Terminal:return"Terminal"',
  'case $t.Browser:return"Browser"',
  'case $t.File:return"File"',
  'case $t.AgentFiles:return"Files"',
  'case $t.Plan:return"Plan"',
  'case $t.EnvironmentSetup:return"Environment"',
  '{value:"source",label:"Source",icon:"arrow-bracket-to-right"}',
  '?"Hide":"Show"',
  '?"Copied":"Copy Domains"',
  '," used"]',
  '{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}',
  'Title,{children:"Imports"}',
  'i18nKey:"<balance>{balance}</balance> remaining"',
  '${r} hour${r===1?"":"s"} and ${o} minute${o===1?"":"s"} left',
  '${r} hour${r===1?"":"s"} left',
  '0 minutes left',
  'Allow agent to switch to modes like Plan or Debug without asking. When off,',
  'asks first, but skips if unanswered within 15 seconds.',
  'These domains must be accessible for ',
  ' to function. Add them to your firewall or proxy allowlist.',
  'Glob patterns for files where ',
  ' Tab will not suggest',
  'Check network connectivity to all '

];

/**
 * Agents sidebar “Source” means 来源. The same word on a file tab means the
 * raw view, so it cannot be a plain `label:"Source"` replacement.
 * The minified binding between these two fields changes between builds.
 */
const SOURCE_FILTER_KEY = 'contentLabel:"Show source filters",label:"Source"';
const SOURCE_FILTER_RE = /contentLabel:"Show source filters",deviates:([A-Za-z_$][\w$]*),label:"Source"/g;

const NAV_RE = /(?:"([A-Za-z0-9-]+)"|([A-Za-z_$][\w$]*)):"((?:\\.|[^"\\])*)"/g;

// 用完整的动作面板标签表识别显示文案，保留用于筛选的属性名。
const PALETTE_TABS_RE = /\{all:"All",(?:projects:"Projects",)?agents:"Agents",files:"Files",actions:"Actions",settings:"Settings"\}/g;

// React Compiler 将标题提升成变量。通过设置 ID 和 Root/Entry 结构识别该组件，
// 不依赖压缩后的变量名，只替换其中的显示标题。
const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const PR_PREFERENCES_RE = new RegExp(
  `(?<![\\w$])${IDENTIFIER}="Pull Requests",${IDENTIFIER}=${IDENTIFIER}\\.Root,` +
  `${IDENTIFIER}="Pull Requests",${IDENTIFIER}="pull-request-preferences"`,
  'g'
);

/**
 * Replace a translation only when the English text is the entire value of a
 * UI field (`label:"…"`, `title:"…"`, …) or a Cursor Settings sidebar name.
 * A word inside a longer string, a search keyword, or an id is left alone.
 */
const EXTRA_DISPLAY_COPY = [
  "Sign-in on this device is restricted by your organization's device policy. Sign in with an allowed account to continue.",
  "Slack isn't available for this Project",
  'Your browser is signed in to another Cursor account. Switch to this one, then connect again.',
  "Slack didn't finish connecting. Connect again to pick up where you left off.",
  'Finish in Slack, then connect again. If Slack asked for approval, an admin must approve Cursor first.',
  'Approve Cursor in Slack. This updates on its own.',
  'Ask a Slack admin to approve Cursor, then connect again'
];

function rewrite(source, dict) {
  FIELD_RE.lastIndex = 0;
  const hits = new Map();
  let count = 0;
  const replaceDisplayLiteral = (full, raw) => {
    const translated = translateLiteral(raw, dict, hits);
    if (translated === null) return full;
    count++;
    return `"${translated}"`;
  };
  const replaceDisplayLiterals = (block) => block.replace(/"((?:\\.|[^"\\])*)"/g, replaceDisplayLiteral);
  let text = source;
  PALETTE_TABS_RE.lastIndex = 0;
  text = text.replace(PALETTE_TABS_RE, replaceDisplayLiterals);
  PR_PREFERENCES_RE.lastIndex = 0;
  text = text.replace(PR_PREFERENCES_RE, block => block.replace(/"(Pull Requests|Review Provider)"/g, replaceDisplayLiteral));
  // Edit-session descriptors contain additional display fields beside placeholder.
  // Match the complete descriptor, leaving queue-item/goal dispatch IDs intact.
  text = text.replace(/\b(?:queueItem|goal):\(\)=>\(\{bannerLabel:"(?:\\.|[^"\\])*",placeholder:"(?:\\.|[^"\\])*",cancelLabel:"(?:\\.|[^"\\])*",pillLabel:"(?:\\.|[^"\\])*",pillTitle:"(?:\\.|[^"\\])*"\}\)/g,
    replaceDisplayLiterals);
  text = text.replace(/\brecordScreenToolCall:\{loading:"Recording screen",completed:"Recorded screen",error:"Record screen"\}/g,
    replaceDisplayLiterals);
  // These contiguous constants belong to the computer permission component.
  // The permission IDs and ordinary Allow/Ready strings elsewhere are untouched.
  text = text.replace(/[A-Za-z_$][\w$]*="Enable Computer Use",[A-Za-z_$][\w$]*="Allow Cursor to use your computer\.",[A-Za-z_$][\w$]*="Cursor Computer Use is not available in this build",[A-Za-z_$][\w$]*="Back to Cursor",[A-Za-z_$][\w$]*="Computer Use is ready",[A-Za-z_$][\w$]*="Allow",[A-Za-z_$][\w$]*="Allowing(?:\\u2026|…)",[A-Za-z_$][\w$]*="Ready"(?=,[A-Za-z_$][\w$]*=\[\{kind:"accessibility")/g,
    replaceDisplayLiterals);
  text = text.replace(FIELD_RE, (full, field, raw) => {
    const translated = translateLiteral(raw, dict, hits);
    if (translated === null) return full;
    count++;
    return `${field}:"${translated}"`;
  });

  // The credits card's parent title is a variable, rather than a literal UI
  // field. Require both its paired commerce locale and the nearby component
  // context so unrelated "Credits" strings and the English locale stay intact.
  text = text.replace(/(?<![\w$])(?:(var|let|const)\s+)?([A-Za-z_$][\w$]*)="Credits",([A-Za-z_$][\w$]*)="en"(?=[;},])/g,
    (full, declaration, title, locale, offset) => {
      const context = text.slice(Math.max(0, offset - 5000), offset + full.length + 5000);
      if (!context.includes('import("./workbench.xai-commerce-prepaid.js")') ||
          !context.includes('"plan-usage-credits-card"') ||
          !new RegExp(`\\btitle\\s*:\\s*${title.replace(/[$]/g, '\\$&')}(?![\\w$])`).test(context) ||
          !new RegExp(`\\blocale\\s*:\\s*${locale.replace(/[$]/g, '\\$&')}(?![\\w$])`).test(context)) return full;
      const translated = translateLiteral('Credits', dict, hits);
      if (translated === null) return full;
      count++;
      return `${declaration ? declaration + ' ' : ''}${title}="${translated}",${locale}="en"`;
    });

  // These full sentences are notification/view-model copy rather than IDs.
  for (const english of EXTRA_DISPLAY_COPY) {
    const from = `"${escapeJs(english)}"`;
    if (!text.includes(from)) continue;
    const translated = translateLiteral(english, dict, hits);
    if (translated === null) continue;
    const occurrences = text.split(from).length - 1;
    count += occurrences;
    hits.set(english, (hits.get(english) || 0) + occurrences - 1);
    text = text.split(from).join(`"${translated}"`);
  }

  text = text.replace(/"aria-label"\s*:\s*"((?:\\.|[^"\\])*)"/g, (full, raw) => {
    const translated = translateLiteral(raw, dict, hits);
    if (translated === null) return full;
    count++;
    return `"aria-label":"${translated}"`;
  });

  NAV_RE.lastIndex = 0;
  text = text.replace(NAV_RE, (full, quotedKey, bareKey, raw) => {
    const key = quotedKey || bareKey;
    const expected = SIDEBAR_ENGLISH[key];
    const english = unescapeJs(raw);
    if (Array.isArray(expected) ? !expected.includes(english) : expected !== english) return full;
    const translated = translateLiteral(raw, dict, hits);
    if (translated === null) return full;
    count++;
    const prop = quotedKey ? `"${quotedKey}"` : bareKey;
    return `${prop}:"${translated}"`;
  });

  if (text.includes(MODE_FROM)) {
    let partCount = 0;
    const modeTo = MODE_PARTS.map(([key, english]) => {
      const translated = translateLiteral(english, dict, hits);
      if (translated === null) return `${key}:"${english}"`;
      partCount++;
      return `${key}:"${translated}"`;
    }).join(',');
    const modeHits = text.split(MODE_FROM).length - 1;
    if (modeHits && partCount) {
      count += modeHits * partCount;
      text = text.split(MODE_FROM).join(modeTo);
    }
  }

  let bareCount = 0;
  for (const english of BARE_LABELS) {
    if (!Object.prototype.hasOwnProperty.call(dict, english)) continue;
    const translated = escapeJs(dict[english]);
    if (translated === english) continue;
    const forms = new Set([`"${english}"`]);
    if (/[^\x00-\x7f]/.test(english)) {
      const hex = english.replace(/[^\x00-\x7f]/g, (ch) => {
        const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
        return `\\u${code}`;
      });
      forms.add(`"${hex}"`);
      forms.add(`"${hex.toUpperCase()}"`);
    }
    for (const from of forms) {
      if (!text.includes(from)) continue;
      const n = text.split(from).length - 1;
      bareCount += n;
      hits.set(english, (hits.get(english) || 0) + n);
      text = text.split(from).join(`"${translated}"`);
    }
  }
  count += bareCount;


  // Complete official templates and JSX splits must run before short PHRASES,
  // so a partial replace cannot leave an English restart or product-name clause.
  const prodRe = IDENTIFIER + "(?:\\(" + IDENTIFIER + "\\))?";
  const templatePatches = [
    [
      /`Apply \.cursorignore files to all subdirectories\$\{([A-Za-z_$][\w$]*)\?" \(controlled by admin\)":""\}\. Changing this setting requires restarting \$\{([A-Za-z_$][\w$]*)\}\.`/g,
      (_, a, b) => "`把 .cursorignore 应用到所有子目录${" + a + '?"（由管理员控制）":""}。更改此项后需要重启 ${' + b + "}。`"
    ],
    [
      /`Use with caution\. Skip symlinks during \.cursorignore file discovery\. Enable only when all \.cursorignore files are reachable without symlinks\$\{([A-Za-z_$][\w$]*)\?" \(controlled by admin\)":""\}\. Changing this setting requires restarting \$\{([A-Za-z_$][\w$]*)\}\.`/g,
      (_, a, b) => "`请谨慎使用。查找 .cursorignore 时跳过符号链接。仅当所有 .cursorignore 不经过符号链接也能找到时再启用${" + a + '?"（由管理员控制）":""}。更改此项后需要重启 ${' + b + "}。`"
    ],
    [
      /\. Changing this setting requires restarting \$\{([A-Za-z_$][\w$]*)\}\./g,
      (_, a) => "。更改此项后需要重启 ${" + a + "}。"
    ],
    [
      /`Control local agents on this computer from the \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} iOS app\.`/g,
      (_, a) => "`通过 ${" + a + "} iOS 应用，控制这台电脑上的本地智能体。`"
    ],
    [
      /`Start, check, and reply to agents running on this computer\. Needs \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} open and the computer awake\.`/g,
      (_, a) => "`启动、查看并回复这台电脑上正在运行的智能体。需保持 ${" + a + "} 打开，且电脑处于唤醒状态。`"
    ],
    [
      /`Always-allowed apps: \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} can use these in any chat without asking\. Remove one to be asked again\.`/g,
      (_, a) => "`始终允许的应用：${" + a + "} 可在任何对话中直接使用这些应用，无需再询问。移除后将重新征求你的同意。`"
    ],
    [
      /`No always-allowed apps yet\. Choose Always Allow when \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} asks to use an app\.`/g,
      (_, a) => "`还没有始终允许的应用。当 ${" + a + "} 请求使用某个应用时，选择“始终允许”。`"
    ],
    [
      /`Allow \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} to use \$\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\}\?`/g,
      (_, a, b) => "`允许 ${" + a + "} 使用 ${" + b + "}？`"
    ],
    [
      /`Sync chats and continue them in \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\}`/g,
      (_, a) => "`同步对话，并在 ${" + a + "} 中继续`"
    ],
    [
      /`Scale of the whole \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} window, the same as Zoom In and Zoom Out`/g,
      (_, a) => "`调整整个 ${" + a + "} 窗口的缩放，与放大、缩小相同`"
    ],
    [
      /`Override the \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} user interface typeface`/g,
      (_, a) => "`覆盖 ${" + a + "} 界面字体`"
    ],
    [
      /`Font size for the \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} user interface`/g,
      (_, a) => "`${" + a + "} 界面的字号`"
    ],
    [
      /`Partially mask your email address in the \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} user interface`/g,
      (_, a) => "`在 ${" + a + "} 界面中部分遮蔽你的邮箱地址`"
    ],
    [
      /`Controls which windows \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} restores on startup`/g,
      (_, a) => "`控制 ${" + a + "} 启动时恢复哪些窗口`"
    ],
    [
      /`Show \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} in the system tray`/g,
      (_, a) => "`在系统托盘中显示 ${" + a + "}`"
    ],
    [
      /`Show \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} in system tray`/g,
      (_, a) => "`在系统托盘中显示 ${" + a + "}`"
    ],
    [
      /`Show \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} in menu bar`/g,
      (_, a) => "`在菜单栏中显示 ${" + a + "}`"
    ],
    [
      /`Domains required for \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\}`/g,
      (_, a) => "`${" + a + "} 所需的域名`"
    ],
    [
      /`Check connectivity to all \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} services`/g,
      (_, a) => "`检查与所有 ${" + a + "} 服务的连接`"
    ],
    [
      /`Verify extension signatures when installing and loading extensions\. May require an editor restart to take effect\.\$\{([A-Za-z_$][\w$]*)\?" \(controlled by admin\)":""\}`/g,
      (_, a) => "`安装和加载扩展时验证签名。可能需要重启编辑器后生效。${" + a + '?"（由管理员控制）":""}`'
    ],
    [
      /`Weekly usage resets on \$\{([^}]+)\} \(\$\{([^}]+)\}\)`/g,
      (_, a, b) => "`每周用量将于 ${" + a + "} 重置（${" + b + "}）`"
    ],
    [
      /`Usage limits reset on \$\{([^}]+)\} \(\$\{([^}]+)\}\)`/g,
      (_, a, b) => "`用量限制将于 ${" + a + "} 重置（${" + b + "}）`"
    ],
    [
      /`Your usage resets on \$\{([A-Za-z_$][\w$]*)\} \(\$\{([A-Za-z_$][\w$]*)\} \$\{([A-Za-z_$][\w$]*)===1\?"day":"days"\}\)\.`/g,
      (_, a, b, c) => "`你的用量将于 ${" + a + "} 重置（${" + b + "} 天）。`"
    ],
    [
      /`Your usage resets on \$\{([A-Za-z_$][\w$]*)\}\.`/g,
      (_, a) => "`你的用量将于 ${" + a + "} 重置。`"
    ],
    [
      /`Included usage with your subscription\.\$\{([A-Za-z_$][\w$]*)\?` Resets \$\{([^}]+)\}\.`:""\}\$\{([A-Za-z_$][\w$]*)\?" Used before your credits\.":""\}`/g,
      (_, a, dateExpr, b) => "`订阅包含的用量。${" + a + "?` 将于 ${" + dateExpr + "} 重置。`:\"\"}${" + b + "?\" 先于额度使用。\":\"\"}`"
    ],
    [
      /`Upgrade to \$\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\} to keep going\.`/g,
      (_, a) => "`升级到 ${" + a + "} 以继续使用。`"
    ],
    [
      /`Adjust your limits to continue, or upgrade to \$\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\}\.`/g,
      (_, a) => "`调整限额以继续，或升级到 ${" + a + "}。`"
    ],
    [
      /`Upgrade to \$\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\}`/g,
      (_, a) => "`升级到 ${" + a + "}`"
    ],
    [
      /`Upgrade to \$\{([A-Za-z_$][\w$]*)\}`/g,
      (_, a) => "`升级到 ${" + a + "}`"
    ],
    [
      /`Get \$\{([A-Za-z_$][\w$]*)\}`/g,
      (_, a) => "`获取 ${" + a + "}`"
    ],
    [
      /`Control whether agents can read files outside the workspace without approval\$\{([A-Za-z_$][\w$]*)\}`/g,
      (_, a) => "`控制智能体未经批准能否读取工作区以外的文件${" + a + "}`"
    ],
    [
      /`Run Mode \(Enforced by ~\/\$\{([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\?\?"\.cursor")\}\/permissions\.json\)`/g,
      (_, a) => "`运行模式（由 ~/${" + a + "}/permissions.json 强制执行）`"
    ],
    [
      /`\$\{([A-Za-z_$][\w$]*)\?"(?:\\u2318|\u2318)Enter":"Ctrl\+Enter"\} submits chat, Enter inserts a newline, and primary actions move to \$\{([A-Za-z_$][\w$]*)\?"(?:\\u2325\\u2318|\u2325\u2318)Enter":"Ctrl\+Alt\+Enter"\}`/g,
      (_, a, b) => "`${" + a + '?"\\u2318Enter":"Ctrl+Enter"} 用于发送对话，Enter 用于换行，主要操作改为 ${' + b + '?"\\u2325\\u2318Enter":"Ctrl+Alt+Enter"}`'
    ],
    [
      /`Submit with \$\{([A-Za-z_$][\w$]*)\?"(?:\\u2318|\u2318) \+ ":"Ctrl \+ "\}Enter`/g,
      (_, a) => "`使用 ${" + a + '?"\\u2318 + ":"Ctrl + "}Enter 发送`'
    ],
    [
      /`Partial Accepts keybinding: \$\{([A-Za-z_$][\w$]*)\}`/g,
      (_, a) => "`部分接受快捷键：${" + a + "}`"
    ],
    [
      /`Allow \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} to use your computer\.`/g,
      (_, a) => "`允许 ${" + a + "} 使用你的电脑。`"
    ],
    [
      /`\$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\} Computer Use is not available in this build`/g,
      (_, a) => "`此版本不支持 ${" + a + "} 电脑操控`"
    ],
    [
      /`Back to \$\{([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\}`/g,
      (_, a) => "`返回 ${" + a + "}`"
    ]

  ];
  const jsxPatches = [

    [
      /\["Sync chats and continue them in ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)\]/g,
      (_, a) => '["同步对话，并在 ",' + a + '," 中继续"]'
    ],
    [
      /\["These domains must be accessible for ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," to function\. Add them to your firewall or proxy allowlist\."\]/g,
      (_, a) => '["这些域名必须可访问，",' + a + '," 才能正常工作。请将它们加入防火墙或代理允许列表。"]'
    ],
    [
      /\["Check network connectivity to all ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," services"\]/g,
      (_, a) => '["检查与所有 ",' + a + '," 服务的网络连接"]'
    ],
    [
      /\["Glob patterns for files where ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," Tab will not suggest"\]/g,
      (_, a) => '["用 glob 指定 ",' + a + '," Tab 不给出建议的文件"]'
    ],
    [
      /\["Allow agent to switch to modes like Plan or Debug without asking\. When off,"," ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?),"asks first, but skips if unanswered within 15 seconds\."\]/g,
      (_, a) => '["允许智能体在未经询问时切换到 Plan 或 Debug 等模式。关闭后，"," ",' + a + '," 会先询问，若 15 秒内未回应则跳过。"]'
    ],
    [
      /\["Your codebase, prompts, edits and other usage data will be stored and trained on by"," ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," to improve the product\."/g,
      (_, a) => '["你的代码库、提示词、编辑内容和其他使用数据将被"," ",' + a + '," 存储并用于训练，以改进产品。"'
    ],
    [
      /\["Your prompts, edits and other usage data will be stored and trained on by"," ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," to improve the product\."/g,
      (_, a) => '["你的提示词、编辑内容和其他使用数据将被"," ",' + a + '," 存储并用于训练，以改进产品。"'
    ],
    [
      /" Prompts and limited telemetry may also be shared with model providers when you explicitly select their models\."/g,
      '" 当你明确选择某家模型时，提示词和有限的遥测数据也可能共享给该模型提供商。"'
    ],
    [
      /"Controls which windows ",([A-Za-z_$][\w$]*(?:\([A-Za-z_$][\w$]*\))?)," restores on startup"/g,
      (_, a) => '"控制 ",' + a + '," 启动时恢复哪些窗口"'
    ]
  ];
  for (const [re, to] of templatePatches.concat(jsxPatches)) {
    re.lastIndex = 0;
    text = text.replace(re, (...args) => {
      const next = typeof to === "function" ? to(...args) : to;
      if (next !== args[0]) {
        count++;
        hits.set(re.source.slice(0, 72), (hits.get(re.source.slice(0, 72)) || 0) + 1);
      }
      return next;
    });
  }

  for (const english of PHRASES) {
    if (!Object.prototype.hasOwnProperty.call(dict, english)) continue;
    const translated = dict[english];
    if (typeof translated !== 'string' || translated === english || !text.includes(english)) continue;
    const n = text.split(english).length - 1;
    count += n;
    hits.set(english, (hits.get(english) || 0) + n);
    text = text.split(english).join(translated);
  }

  const sourceFilter = dict[SOURCE_FILTER_KEY];
  if (typeof sourceFilter === 'string' && sourceFilter !== SOURCE_FILTER_KEY && sourceFilter.includes('",label:"')) {
    SOURCE_FILTER_RE.lastIndex = 0;
    text = text.replace(SOURCE_FILTER_RE, (full, binding) => {
      count++;
      hits.set(SOURCE_FILTER_KEY, (hits.get(SOURCE_FILTER_KEY) || 0) + 1);
      return sourceFilter.replace('",label:"', `",deviates:${binding},label:"`);
    });
  }

  return { text, count, hits };
}



function parseArgs(argv) {
  const opt = {
    dryRun: false,
    stagingDir: null,
    adaptNewVersion: false,
    skipRestore: false,
    expectVersion: EXPECTED_VERSION,
    backupDir: process.env.CURSOR_I18N_BACKUP || DEFAULT_BACKUP_DIR,
    writeState: true
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opt.dryRun = true;
    else if (a === "--adapt-new-version") opt.adaptNewVersion = true;
    else if (a === "--skip-restore") opt.skipRestore = true;
    else if (a === "--no-state") opt.writeState = false;
    else if (a === "--staging") opt.stagingDir = argv[++i];
    else if (a === "--expect-version") opt.expectVersion = argv[++i];
    else if (a === "--backup-dir") opt.backupDir = argv[++i];
    else fail("未知参数：" + a);
  }
  return opt;
}

function versionParts(v) {
  return String(v || "").split(/[^\d]+/).filter(Boolean).map((n) => Number(n) || 0);
}

function compareVersion(a, b) {
  const pa = versionParts(a), pb = versionParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function findLanguagePack() {
  const extRoot = path.join(HOME, ".cursor", "extensions");
  if (!fs.existsSync(extRoot)) return null;
  const dirs = fs.readdirSync(extRoot).filter((d) => d.startsWith("ms-ceintl.vscode-language-pack-zh-hans-"));
  if (!dirs.length) return null;
  dirs.sort((a, b) => {
    const va = a.replace(/^ms-ceintl\.vscode-language-pack-zh-hans-/, "").replace(/-universal$/, "");
    const vb = b.replace(/^ms-ceintl\.vscode-language-pack-zh-hans-/, "").replace(/-universal$/, "");
    return compareVersion(va, vb);
  });
  const latest = dirs[dirs.length - 1];
  const pack = path.join(extRoot, latest, "translations", "main.i18n.json");
  return fs.existsSync(pack) ? { id: latest, path: pack } : null;
}

function readBackupManifest(backupDir) {
  const mf = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(mf)) return null;
  return JSON.parse(fs.readFileSync(mf, "utf8"));
}

function fail(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function checksumBase64(buf) {
  return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
}

function atomicWrite(file, content, encoding) {
  const tmp = file + ".taichu-i18n.tmp";
  if (typeof content === "string") fs.writeFileSync(tmp, content, encoding || "utf8");
  else fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function runningCursor() {
  const runner = path.join(WORK_DIR, "guard", "check-cursor-running.ps1");
  try {
    if (fs.existsSync(runner)) {
      const out = execSync("powershell -NoProfile -ExecutionPolicy Bypass -File " + JSON.stringify(runner), {
        encoding: "utf8",
        windowsHide: true
      }).trim();
      if (!out || out === "running=none") return [];
      return out.split(/\r?\n/).filter((line) => line && line !== "running=none");
    }
  } catch (err) {
    const fallback = String((err && err.stdout) || "");
    if (fallback.trim() && fallback.trim() !== "running=none") {
      return fallback.split(/\r?\n/).filter((line) => line && line !== "running=none");
    }
  }
  try {
    const out = execSync("tasklist /FI \"IMAGENAME eq Cursor.exe\" /FO CSV /NH", {
      encoding: "utf8",
      windowsHide: true
    });
    if (/Cursor\.exe/i.test(out) && !/No tasks/i.test(out)) return [out.trim()];
  } catch (_err) {}
  return [];
}

function syncChecksums() {
  const productFile = path.join(APP_ROOT, "product.json");
  const before = fs.readFileSync(productFile);
  let text = before.toString("utf8");
  let changed = 0;
  for (const rel of BUNDLES) {
    const key = rel.replace(/^out\//, "");
    const file = path.join(APP_ROOT, ...rel.split("/"));
    if (!fs.existsSync(file)) continue;
    const re = new RegExp("(\"" + key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\"\\s*:\\s*\")([^\"]*)(\")");
    if (!re.test(text)) continue;
    const hash = checksumBase64(fs.readFileSync(file));
    text = text.replace(re, (full, open, current, close) => {
      if (current === hash) return full;
      changed++;
      return open + hash + close;
    });
  }
  if (changed) atomicWrite(productFile, text, "utf8");
  return changed;
}


function main() {
  const opt = parseArgs(process.argv);
  const dictFile = path.join(WORK_DIR, "hardcoded-patch-dict-v3.json");
  const nlsFile = path.join(WORK_DIR, "nls-delta-v3.json");
  if (!fs.existsSync(dictFile)) fail("找不到词库：" + dictFile);
  const dict = JSON.parse(fs.readFileSync(dictFile, "utf8"));
  const nlsDelta = fs.existsSync(nlsFile) ? JSON.parse(fs.readFileSync(nlsFile, "utf8")) : {};

  const productFileLive = path.join(APP_ROOT, "product.json");
  if (!fs.existsSync(productFileLive)) fail("找不到 product.json：" + productFileLive);
  const product = JSON.parse(fs.readFileSync(productFileLive, "utf8"));
  const version = product.version || product.cursorVersion || "";
  if (version !== opt.expectVersion && !opt.adaptNewVersion) {
    fail("Cursor 版本是 " + version + "，不是 " + opt.expectVersion + "，已中止。若要在新版本上用现有词库重打，请使用 --adapt-new-version。");
  }

  const packInfo = findLanguagePack();
  if (!packInfo) fail("找不到官方简体中文语言包（ms-ceintl.vscode-language-pack-zh-hans-*）。");

  const staging = opt.stagingDir;
  const appRoot = staging ? path.join(staging, "app") : APP_ROOT;
  const packPath = staging ? path.join(staging, "language-pack", "main.i18n.json") : packInfo.path;
  if (staging) {
    fs.mkdirSync(path.join(staging, "language-pack"), { recursive: true });
    fs.mkdirSync(appRoot, { recursive: true });
    if (!fs.existsSync(packPath)) {
      fs.mkdirSync(path.dirname(packPath), { recursive: true });
      fs.copyFileSync(packInfo.path, packPath);
    }
    const destProduct = path.join(appRoot, "product.json");
    if (!fs.existsSync(destProduct)) {
      fs.mkdirSync(path.dirname(destProduct), { recursive: true });
      fs.copyFileSync(path.join(APP_ROOT, "product.json"), destProduct);
    }
    for (const rel of BUNDLES) {
      const srcFile = path.join(APP_ROOT, ...rel.split("/"));
      const dest = path.join(appRoot, ...rel.split("/"));
      if (!fs.existsSync(srcFile)) continue;
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(srcFile, dest);
      }
    }
  }

  if (!opt.dryRun && !staging) {
    const running = runningCursor();
    if (running.length) {
      console.error("Cursor 仍在运行，已中止，未改任何文件。请完全退出 Cursor（包括托盘图标）后再试。");
      for (const line of running) console.error("  " + line);
      process.exit(2);
    }
  }

  const backupDir = opt.backupDir;
  if (fs.existsSync(LEGACY_BACKUP_DIR) && path.resolve(backupDir) === path.resolve(LEGACY_BACKUP_DIR)) {
    fail("拒绝使用 3.31.15 备份目录，以免覆盖或误还原旧备份。");
  }
  const manifest = readBackupManifest(backupDir);
  const restored = [];
  const shouldRestore = !opt.skipRestore && manifest && manifest.version === version && fs.existsSync(path.join(backupDir, BACKUP_MAP["product.json"]));
  if (shouldRestore) {
    const targets = [];
    targets.push({ src: path.join(backupDir, BACKUP_MAP["product.json"]), dest: path.join(appRoot, "product.json"), rel: "product.json" });
    for (const rel of BUNDLES) {
      const srcFile = path.join(backupDir, BACKUP_MAP[rel]);
      const dest = path.join(appRoot, ...rel.split("/"));
      if (fs.existsSync(srcFile) && (fs.existsSync(dest) || staging)) targets.push({ src: srcFile, dest, rel });
    }
    if (!staging) {
      const packBackup = path.join(backupDir, "language-pack", "main.i18n.json");
      if (fs.existsSync(packBackup) && fs.existsSync(packPath)) {
        targets.push({ src: packBackup, dest: packPath, rel: "language-pack/main.i18n.json" });
      }
    }
    for (const t of targets) {
      if (!opt.dryRun) {
        fs.mkdirSync(path.dirname(t.dest), { recursive: true });
        fs.copyFileSync(t.src, t.dest);
      }
      restored.push(t.rel);
    }
    console.log("restored from " + backupDir + " count=" + restored.length);
  } else if (!opt.skipRestore && manifest && manifest.version !== version) {
    console.log("skip restore: backup is for " + manifest.version + ", current is " + version);
  }

  function targetPath(rel) {
    return path.join(appRoot, ...rel.split("/"));
  }

  const preHashes = {};
  function hashIfExists(label, file) {
    if (fs.existsSync(file)) preHashes[label] = sha256(fs.readFileSync(file));
  }
  hashIfExists("product.json", path.join(appRoot, "product.json"));
  hashIfExists("language-pack/main.i18n.json", packPath);
  for (const rel of BUNDLES) hashIfExists(rel, targetPath(rel));

  let nlsAdded = 0, nlsUpdated = 0, nlsSame = 0;
  if (!fs.existsSync(packPath)) fail("找不到语言包：" + packPath);
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  if (!pack.contents) fail("语言包格式异常，缺少 contents。");
  for (const [mod, rec] of Object.entries(nlsDelta)) {
    if (!pack.contents[mod]) pack.contents[mod] = {};
    for (const [key, zh] of Object.entries(rec)) {
      const prev = pack.contents[mod][key];
      if (prev === zh) { nlsSame++; continue; }
      if (prev === undefined) nlsAdded++;
      else nlsUpdated++;
      pack.contents[mod][key] = zh;
    }
  }
  if (!opt.dryRun) atomicWrite(packPath, JSON.stringify(pack, null, "\t") + "\n", "utf8");
  console.log("nls added=" + nlsAdded + " updated=" + nlsUpdated + " already=" + nlsSame);

  const bundleReport = [];
  const hitKeys = new Set();
  for (const rel of BUNDLES) {
    const file = targetPath(rel);
    if (!fs.existsSync(file)) {
      bundleReport.push({ rel, missing: true });
      continue;
    }
    const before = fs.readFileSync(file);
    const source = before.toString("utf8");
    const { text, count, hits } = rewrite(source, dict);
    for (const keyName of hits.keys()) hitKeys.add(keyName);
    if (count === 0) {
      bundleReport.push({ rel, replacements: 0, unique: 0, sha256Before: sha256(before) });
      continue;
    }
    if (!opt.dryRun) atomicWrite(file, text, "utf8");
    bundleReport.push({
      rel,
      replacements: count,
      unique: hits.size,
      sha256Before: sha256(before),
      sha256After: sha256(Buffer.from(text))
    });
    console.log("bundle " + rel + " replacements=" + count + " unique=" + hits.size);
  }

  let checksums = 0;
  const productFile = path.join(appRoot, "product.json");
  if (!opt.dryRun) {
    const before = fs.readFileSync(productFile);
    let text = before.toString("utf8");
    let changed = 0;
    for (const rel of BUNDLES) {
      const checksumKey = rel.replace(/^out\//, "");
      const file = targetPath(rel);
      if (!fs.existsSync(file)) continue;
      const escaped = checksumKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cre = new RegExp("(\"" + escaped + "\"\\s*:\\s*\")([^\"]*)(\")");
      if (!cre.test(text)) continue;
      const hash = checksumBase64(fs.readFileSync(file));
      text = text.replace(cre, (full, open, current, close) => {
        if (current === hash) return full;
        changed++;
        return open + hash + close;
      });
    }
    if (changed) atomicWrite(productFile, text, "utf8");
    checksums = changed;
  }
  console.log("checksumsUpdated=" + checksums);

  const productText = fs.readFileSync(productFile, "utf8");
  const desktopKey = "vs/workbench/workbench.desktop.main.js";
  const desktopRe = new RegExp("\"" + desktopKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"\\s*:\\s*\"([^\"]*)\"");
  const desktopMatch = productText.match(desktopRe);
  const desktopFile = path.join(appRoot, "out", ...desktopKey.split("/"));
  const fileHash = fs.existsSync(desktopFile) ? checksumBase64(fs.readFileSync(desktopFile)) : "";
  const checksumOk = opt.dryRun ? true : !!(desktopMatch && desktopMatch[1] === fileHash);
  console.log("desktopChecksumOk=" + checksumOk);

  const postHashes = {};
  if (!opt.dryRun) {
    const store = (label, file) => {
      if (fs.existsSync(file)) postHashes[label] = sha256(fs.readFileSync(file));
    };
    store("product.json", productFile);
    store("language-pack/main.i18n.json", packPath);
    for (const rel of BUNDLES) store(rel, targetPath(rel));
  }

  const log = {
    ok: checksumOk,
    version,
    dryRun: !!opt.dryRun,
    staging: staging || null,
    backupDir,
    restored,
    languagePack: packInfo.id,
    languagePackPath: packPath,
    dictSize: Object.keys(dict).length,
    nlsModules: Object.keys(nlsDelta).length,
    nlsAdded,
    nlsUpdated,
    nlsSame,
    bundles: bundleReport,
    checksumsUpdated: checksums,
    desktopChecksumOk: checksumOk,
    uniqueHitCount: hitKeys.size,
    preHashes,
    postHashes
  };
  if (!opt.dryRun) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.writeFileSync(path.join(WORK_DIR, "apply-log-v3.json"), JSON.stringify(log, null, 2), "utf8");
    if (opt.writeState && !staging) {
      const stateDir = path.join(WORK_DIR, "guard");
      fs.mkdirSync(stateDir, { recursive: true });
      const state = {
        lastAppliedVersion: version,
        lastAppliedAt: new Date().toISOString(),
        languagePack: packInfo.id,
        backupDir,
        preHashes,
        postHashes,
        markers: ["远程控制", "计划与用量", "配对设备"]
      };
      fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
    }
  } else {
    console.log("dry-run, no files written to the install directory");
  }
  if (!checksumOk) fail("安装校验未对齐，请不要打开 Cursor，等我修复。");
  console.log("uniqueHits=" + hitKeys.size);
  console.log("done");
}

main();
